import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AudioPlayer from '../../src/components/AudioPlayer';
import EbookReader from '../../src/components/EbookReader';
import { useLibraryStore } from '../../src/store/libraryStore';
import { colors, radius, spacing, typography } from '../../src/theme';
import type { AudiobookPositionMap, ChapterPosition, EbookPosition, ReaderMode } from '../../src/types';
import { audioMsToChapterPosition, audioMsToPercentage, buildChapterAnchors, chapterPositionToAudioMs, deriveBuiltFrom, msToFilePosition, percentageToAudioMs, refineChapterAnchor, type ChapterText } from '../../src/utils/alignSync';
import { downloadModel, isModelDownloaded, releaseWhisperContext, transcribeFile } from '../../src/utils/transcribeAudio';
import { deletePositionMap, loadPositionMap, savePositionMap } from '../../src/utils/positionMapStorage';
import { deleteTranscriptionCache, loadCachedFileSegments, loadCacheMeta, saveFileSegments } from '../../src/utils/transcriptionCache';
import { deleteChapterTexts, loadChapterTexts, saveChapterTexts } from '../../src/utils/chapterTextStorage';

interface SyncBanner {
  targetMode: ReaderMode;
  /** 0–1 fractional position to jump to in the target mode */
  percentage: number;
  /** Pre-computed audio seek target (only set when targetMode === 'audio') */
  targetFileIndex?: number;
  targetSeconds?: number;
  /** When set, jump to this spine chapter index instead of using percentage */
  targetChapterIndex?: number;
  /** Human-readable label for targetChapterIndex (e.g. "57: WANDERSAIL") */
  targetChapterLabel?: string;
}

type IndexPhase = 'idle' | 'extracting' | 'downloading' | 'transcribing' | 'aligning' | 'done' | 'error';
interface IndexStatus {
  phase: IndexPhase;
  /** 0–1 */
  progress: number;
  /** Which audio file is currently being transcribed (0-based) */
  transcribeFileIndex?: number;
  error?: string;
}

/** Build a map from spine chapter index → fractional range in total book text.
 *  Used to convert between overall percentage and within-chapter fraction. */
function buildChapterPctMap(
  chapters: ChapterText[],
): Map<number, { start: number; end: number }> {
  const contentChapters = chapters.filter((c) => c.text.trim().length >= 500);
  if (!contentChapters.length) return new Map();
  const totalChars = contentChapters.reduce((sum, c) => sum + c.text.length, 0);
  const map = new Map<number, { start: number; end: number }>();
  let cum = 0;
  for (const ch of contentChapters) {
    const frac = ch.text.length / totalChars;
    map.set(ch.chapterIndex, { start: cum, end: cum + frac });
    cum += frac;
  }
  return map;
}

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { getBook, updateEbookPosition, updateAudioPosition, updateAudioFileDuration, setLastMode, setPositionMapCreatedAt } =
    useLibraryStore();
  const book = getBook(id);

  const [mode, setMode] = useState<ReaderMode>(book?.session.lastMode ?? 'ebook');
  const [showSettings, setShowSettings] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [fontSize, setFontSize] = useState(18);
  const [syncBanner, setSyncBanner] = useState<SyncBanner | null>(null);
  /** When non-null, EpubReader will navigate to this percentage (0-1) */
  const [epubTargetPercentage, setEpubTargetPercentage] = useState<number | null>(null);
  /** When non-null, EpubReader will navigate to this spine chapter index */
  const [epubTargetChapter, setEpubTargetChapter] = useState<number | null>(null);
  /** Bump to remount AudioPlayer and apply a new seeked position from the store */
  const [audioPlayerKey, setAudioPlayerKey] = useState(0);
  const [devMode, setDevMode] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(50); // px/s
  const [epubGoNextRequest, setEpubGoNextRequest] = useState(0);
  const [epubGoPrevRequest, setEpubGoPrevRequest] = useState(0);
  const logsRef = useRef<string[]>([]);

  // Position map (live, progressively refined anchors)
  const [positionMap, setPositionMap] = useState<AudiobookPositionMap | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  /** Increment to trigger epub text extraction from the WebView */
  const [textExtractRequest, setTextExtractRequest] = useState(0);
  /** Set to true when component unmounts or book changes — cancels in-flight indexing */
  const indexCancelledRef = useRef(false);
  /** Accumulated chapter texts from epub — filled when textExtracted fires */
  const chaptersRef = useRef<ChapterText[]>([]);

  // Canonical position tracking (chapterIndex + withinChapterFraction = book position
  // independent of whether the user is reading or listening)
  const canonicalChapterIndexRef = useRef<number>(-1);
  const canonicalWithinChapterFractionRef = useRef<number>(0);
  /** AudioMs captured during position changes — used by handleSyncAccept to add anchors */
  const pendingSwitchAudioMsRef = useRef<number>(0);
  /** Maps spine chapter index → {start, end} fractional range in total book text */
  const chapterPctMapRef = useRef<Map<number, { start: number; end: number }>>(new Map());

  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Keep a ref to the latest book so switchMode can read session without stale closure
  const bookRef = useRef(book);
  bookRef.current = book;

  useEffect(() => {
    if (!book) router.back();
  }, [book, router]);

  useEffect(() => {
    if (book) setLastMode(book.id, mode);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-scan durations for all audio tracks so the full book length is known
  // immediately, not just after each track is played.
  useEffect(() => {
    const uris = book?.audioUris;
    const bookId = book?.id;
    if (!uris?.length || !bookId) return;

    let cancelled = false;
    const cached = book.session.audioFileDurations ?? [];

    (async () => {
      for (let i = 0; i < uris.length; i++) {
        if (cancelled) break;
        if (cached[i] != null && cached[i] > 0) continue; // already known
        try {
          const { sound, status } = await Audio.Sound.createAsync(
            { uri: uris[i] },
            { shouldPlay: false },
          );
          if (!cancelled && status.isLoaded && status.durationMillis) {
            updateAudioFileDuration(bookId, i, status.durationMillis / 1000);
          }
          await sound.unloadAsync();
        } catch {
          // skip unreadable file
        }
      }
    })();

    return () => { cancelled = true; };
  }, [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel any in-flight indexing when the component unmounts or book changes
  useEffect(() => {
    indexCancelledRef.current = false;
    return () => { indexCancelledRef.current = true; };
  }, [book?.id]);

  // Load persisted position map and chapter texts when the book changes.
  useEffect(() => {
    if (!book?.id) return;
    (async () => {
      const map = await loadPositionMap(book.id);
      if (map) setPositionMap(map);

      // Load chapter texts (used by ensurePositionMap and canonical tracking)
      const texts = await loadChapterTexts(book.id);
      if (texts?.length) {
        chaptersRef.current = texts;
        chapterPctMapRef.current = buildChapterPctMap(texts);
      }
    })();
  }, [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLog = useCallback((message: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    const entry = `${ts} ${message}`;
    logsRef.current = [...logsRef.current, entry];
    setLogs((prev) => [...prev, entry]);
  }, []);

  /** Called when epub.js finishes extracting chapter texts — continues the indexing pipeline */
  const handleTextExtracted = useCallback(
    async (chapters: ChapterText[]) => {
      chaptersRef.current = chapters;
      chapterPctMapRef.current = buildChapterPctMap(chapters);
      const b = bookRef.current;
      const substantiveChapters = chapters.filter((c) => c.text.trim().length >= 500);
      handleLog(
        `[index] epub extracted ${chapters.length} chapters (${substantiveChapters.length} with content ≥500 chars)` +
        (chapters[0]?.label != null
          ? ': ' + substantiveChapters.map((c) => c.label || `spine${c.chapterIndex}`).join(', ')
          : ''),
      );
      if (!b?.audioUris?.length || !chapters.length) {
        const err = 'No audio or ebook content found';
        handleLog(`[index] error: ${err}`);
        setIndexStatus({ phase: 'error', progress: 0, error: err });
        return;
      }

      try {
        // Download model if needed
        if (!(await isModelDownloaded())) {
          if (indexCancelledRef.current) return;
          handleLog('[index] downloading whisper model…');
          setIndexStatus({ phase: 'downloading', progress: 0 });
          await downloadModel((p) => {
            if (!indexCancelledRef.current)
              setIndexStatus({ phase: 'downloading', progress: p });
          });
          handleLog('[index] model download complete');
        } else {
          handleLog('[index] whisper model already downloaded');
        }

        if (indexCancelledRef.current) { releaseWhisperContext(); return; }

        // Transcribe each audio file, offsetting timestamps to be relative to audiobook start.
        const audioUris = b.audioUris!;
        const transcriptWords: { audioMs: number; text: string }[] = [];
        let cumulativeMs = 0;

        // Check for a previously interrupted transcription run
        const cacheMeta = await loadCacheMeta(b.id, audioUris);
        const completedSet = new Set(cacheMeta?.completedIndices ?? []);
        const resuming = completedSet.size > 0;
        handleLog(
          resuming
            ? `[index] resuming — ${completedSet.size}/${audioUris.length} files already cached`
            : `[index] transcribing ${audioUris.length} audio file(s)`,
        );

        for (let i = 0; i < audioUris.length; i++) {
          if (indexCancelledRef.current) { releaseWhisperContext(); return; }
          const fileName = audioUris[i].split('/').pop() ?? `file ${i + 1}`;

          // Re-use cached segments if this file was already transcribed
          // Treat a cached-but-empty result as a miss — re-transcribe so alignment can succeed.
          const rawCached = completedSet.has(i) ? await loadCachedFileSegments(b.id, i) : null;
          const cached = rawCached && rawCached.length > 0 ? rawCached : null;
          let segs: Awaited<ReturnType<typeof transcribeFile>>;
          if (cached) {
            segs = cached;
            handleLog(`[index] file ${i + 1}/${audioUris.length} (cached): ${fileName} — ${segs.length} segments`);
          } else {
            if (rawCached && rawCached.length === 0) {
              handleLog(`[index] file ${i + 1}/${audioUris.length} (cached empty — re-transcribing): ${fileName}`);
            }
            handleLog(`[index] transcribing file ${i + 1}/${audioUris.length}: ${fileName}`);
            setIndexStatus({ phase: 'transcribing', progress: i / audioUris.length, transcribeFileIndex: i });
            segs = await transcribeFile(audioUris[i], (p) => {
              if (!indexCancelledRef.current)
                setIndexStatus({
                  phase: 'transcribing',
                  progress: (i + p) / audioUris.length,
                  transcribeFileIndex: i,
                });
            });
            handleLog(`[index] file ${i + 1} done — ${segs.length} segments`);
            // Persist so a future resume can skip this file
            await saveFileSegments(b.id, i, segs, audioUris);
          }

          // Derive this file's duration from its last segment (whisper knows the file length).
          // Fall back to the store-cached duration (seconds → ms) if whisper returned no segments.
          const storedDurationMs = (b.session.audioFileDurations[i] ?? 0) * 1000;
          const fileDurationMs = segs.length > 0 ? segs[segs.length - 1].t1Ms : storedDurationMs;
          // Offset transcript timestamps so they're relative to the whole audiobook
          for (const s of segs) {
            transcriptWords.push({ audioMs: s.t0Ms + cumulativeMs, text: s.text });
          }
          cumulativeMs += fileDurationMs;
        }

        releaseWhisperContext();
        if (indexCancelledRef.current) return;

        handleLog(`[index] aligning ${transcriptWords.length} transcript segments to ${chapters.length} chapters…`);
        setIndexStatus({ phase: 'aligning', progress: 0 });

        const chapterAnchors = buildChapterAnchors(transcriptWords, chaptersRef.current, cumulativeMs);

        if (indexCancelledRef.current) return;

        const map: AudiobookPositionMap = {
          bookId: b.id,
          createdAt: Date.now(),
          totalAudioMs: cumulativeMs,
          chapterAnchors,
          builtFrom: deriveBuiltFrom(chapterAnchors),
        };
        await deleteTranscriptionCache(b.id);
        await saveChapterTexts(b.id, chapters);
        setPositionMapCreatedAt(b.id, map.createdAt);

        await savePositionMap(map);
        setPositionMap(map);

        setIndexStatus({ phase: 'done', progress: 1 });
        handleLog(`[index] sync map saved ✓ (${map.chapterAnchors.length} anchors, ${map.builtFrom})`);
      } catch (err) {
        releaseWhisperContext();
        const msg = err instanceof Error ? err.message : String(err);
        handleLog(`[index] error: ${msg}`);
        if (!indexCancelledRef.current)
          setIndexStatus({
            phase: 'error',
            progress: 0,
            error: msg,
          });
      }
    },
    [setPositionMapCreatedAt, handleLog],
  );

  /** Start the sync index build: request epub text extraction first */
  const startBuildIndex = useCallback(() => {
    const b = bookRef.current;
    if (mode !== 'ebook' || b?.ebookFormat !== 'epub') return;
    setIndexStatus({ phase: 'extracting', progress: 0 });
    setTextExtractRequest((n) => n + 1);
  }, [mode]);

  const handleRebuildIndex = useCallback(async () => {
    const b = bookRef.current;
    if (!b) return;
    await Promise.all([
      deletePositionMap(b.id),
      deleteTranscriptionCache(b.id),
      deleteChapterTexts(b.id),
    ]);
    setPositionMapCreatedAt(b.id, undefined);
    setPositionMap(null);
    setIndexStatus(null);
  }, [setPositionMapCreatedAt]);

  const switchMode = useCallback(
    (next: ReaderMode) => {
      if (next === mode) return;

      const b = bookRef.current;
      if (b) {
        const durationsMs = (b.session.audioFileDurations ?? []).map((duration) => (duration ?? 0) * 1000);
        const totalAudioMs = durationsMs.reduce((sum, durationMs) => sum + durationMs, 0);
        const syncStrategy = b.ebookFormat === 'epub' ? 'chapter' : 'percentage';

        if (mode === 'audio' && next === 'ebook' && totalAudioMs > 0) {
          const elapsedMs =
            durationsMs.slice(0, b.session.audioFileIndex).reduce((sum, durationMs) => sum + durationMs, 0) +
            b.session.audioPosition * 1000;
          pendingSwitchAudioMsRef.current = elapsedMs;

          if (syncStrategy === 'chapter' && positionMap?.chapterAnchors.length) {
            const chapterPosition = audioMsToChapterPosition(positionMap.chapterAnchors, elapsedMs);
            const chLabel = chaptersRef.current.find((c) => c.chapterIndex === chapterPosition.chapterIndex)?.label;
            setSyncBanner({
              targetMode: 'ebook',
              percentage: audioMsToPercentage(elapsedMs, totalAudioMs),
              targetChapterIndex: chapterPosition.chapterIndex,
              targetChapterLabel: chLabel,
            });
            handleLog(`[sync] audio→ebook: audioMs=${elapsedMs} → ch${chapterPosition.chapterIndex}`);
          } else {
            const pct = audioMsToPercentage(elapsedMs, totalAudioMs);
            if (pct > 0.01) setSyncBanner({ targetMode: 'ebook', percentage: pct });
          }
        } else if (mode === 'ebook' && next === 'audio' && totalAudioMs > 0) {
          const pct = b.session.ebookPosition.percentage;
          const spineIndex = b.session.ebookPosition.spineIndex ?? -1;
          if (spineIndex >= 0 || pct > 0.01) {
            if (syncStrategy === 'chapter' && positionMap?.chapterAnchors.length) {
              const chapterPosition: ChapterPosition = {
                chapterIndex: canonicalChapterIndexRef.current >= 0 ? canonicalChapterIndexRef.current : spineIndex,
                withinChapterFraction: canonicalWithinChapterFractionRef.current,
              };
              const targetMs = chapterPositionToAudioMs(positionMap.chapterAnchors, chapterPosition);
              const { fileIndex, fileSeconds } = msToFilePosition(targetMs, durationsMs);
              pendingSwitchAudioMsRef.current = targetMs;
              setSyncBanner({ targetMode: 'audio', percentage: pct, targetFileIndex: fileIndex, targetSeconds: fileSeconds });
              handleLog(
                `[sync] ebook→audio: ch${chapterPosition.chapterIndex} frac=${chapterPosition.withinChapterFraction.toFixed(3)}` +
                ` audioMs=${targetMs} → fileIdx=${fileIndex} fileSeconds=${fileSeconds.toFixed(1)}`,
              );
            } else {
              const targetMs = percentageToAudioMs(pct, totalAudioMs);
              const { fileIndex, fileSeconds } = msToFilePosition(targetMs, durationsMs);
              pendingSwitchAudioMsRef.current = targetMs;
              setSyncBanner({ targetMode: 'audio', percentage: pct, targetFileIndex: fileIndex, targetSeconds: fileSeconds });
              handleLog(`[sync] ebook→audio: pct=${pct.toFixed(3)} audioMs=${targetMs}`);
            }
          }
        }
      }

      if (mode === 'ebook') {
        setEpubTargetPercentage(null);
        setEpubTargetChapter(null);
        setAutoScrollActive(false);
      }

      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setMode(next);
    },
    [mode, fadeAnim, positionMap, handleLog],
  );

  const handleSyncAccept = useCallback(async () => {
    const b = bookRef.current;
    if (!syncBanner || !b) return;

    const map = positionMap;
    const audioMs = pendingSwitchAudioMsRef.current;
    const canonicalCh = canonicalChapterIndexRef.current;
    const canonicalFrac = canonicalWithinChapterFractionRef.current;

    if (map && canonicalCh >= 0) {
      const totalAudioMs = map.totalAudioMs;
      const confirmed = {
        chapterIndex: canonicalCh,
        withinChapterFraction: syncBanner.targetMode === 'ebook' ? 0 : canonicalFrac,
        audioMs,
      };
      const refined = refineChapterAnchor(
        map.chapterAnchors,
        confirmed,
        totalAudioMs,
      );
      if (refined !== map.chapterAnchors) {
        const updated: AudiobookPositionMap = { ...map, chapterAnchors: refined, builtFrom: deriveBuiltFrom(refined) };
        setPositionMap(updated);
        await savePositionMap(updated);
        handleLog(
          `[posmap] confirmed anchor: audioMs=${audioMs} ch=${canonicalCh}` +
          ` frac=${canonicalFrac.toFixed(3)} (${refined.length} anchors total)`,
        );
      }
    }

    // Apply the jump
    if (syncBanner.targetMode === 'ebook') {
      if (syncBanner.targetChapterIndex != null) {
        setEpubTargetChapter(syncBanner.targetChapterIndex);
      } else {
        setEpubTargetPercentage(syncBanner.percentage);
      }
    } else {
      updateAudioPosition(b.id, syncBanner.targetFileIndex ?? 0, syncBanner.targetSeconds ?? 0);
      setAudioPlayerKey((k) => k + 1);
    }
    setSyncBanner(null);
  }, [syncBanner, updateAudioPosition, positionMap, handleLog]);

  const handleEbookPositionChange = useCallback(
    (position: Partial<EbookPosition>) => {
      if (!book) return;
      updateEbookPosition(book.id, position);

      // Derive canonical (chapterIndex, withinChapterFraction) from spineIndex + percentage
      const spineIndex = position.spineIndex ?? book.session.ebookPosition.spineIndex ?? -1;
      const pct = position.percentage ?? book.session.ebookPosition.percentage;
      if (spineIndex >= 0) {
        canonicalChapterIndexRef.current = spineIndex;
        const entry = chapterPctMapRef.current.get(spineIndex);
        if (entry) {
          const withinChapterFraction = entry.end > entry.start
            ? (pct - entry.start) / (entry.end - entry.start)
            : 0;
          canonicalWithinChapterFractionRef.current = Math.max(0, Math.min(1, withinChapterFraction));
        } else {
          canonicalWithinChapterFractionRef.current = 0;
        }
      }
    },
    [book, updateEbookPosition],
  );

  const handleAudioPositionChange = useCallback(
    (fileIndex: number, seconds: number) => {
      if (!book) return;
      updateAudioPosition(book.id, fileIndex, seconds);

      const durationsMs = (book.session.audioFileDurations ?? []).map((duration) => (duration ?? 0) * 1000);
      const audioMs = durationsMs.slice(0, fileIndex).reduce((sum, durationMs) => sum + durationMs, 0) + seconds * 1000;
      pendingSwitchAudioMsRef.current = audioMs;

      const map = positionMap;
      if (map?.chapterAnchors.length) {
        const canonical = audioMsToChapterPosition(map.chapterAnchors, audioMs);
        canonicalChapterIndexRef.current = canonical.chapterIndex;
        canonicalWithinChapterFractionRef.current = canonical.withinChapterFraction;
      }
    },
    [book, updateAudioPosition, positionMap],
  );

  const handleDurationLoaded = useCallback(
    (fileIndex: number, seconds: number) => {
      if (book) updateAudioFileDuration(book.id, fileIndex, seconds);
    },
    [book, updateAudioFileDuration],
  );

  const handleAutoScrollEnd = useCallback(() => {
    setAutoScrollActive(false);
  }, []);

  const copyLogs = useCallback(async () => {
    const text = logsRef.current.join('\n') || '(no logs yet)';
    await Clipboard.setStringAsync(text);
  }, []);

  if (!book) return null;

  const canEbook = Boolean(book.ebookUri && book.ebookFormat);
  const canAudio = Boolean(book.audioUris?.length);
  const activeMode =
    mode === 'ebook' && canEbook ? 'ebook'
    : mode === 'audio' && canAudio ? 'audio'
    : canEbook ? 'ebook' : 'audio';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{book.title}</Text>
          {book.author ? (
            <Text style={styles.headerAuthor} numberOfLines={1}>{book.author}</Text>
          ) : null}
        </View>

        <Pressable testID="settings-btn" onPress={() => setShowSettings((v) => !v)} style={styles.settingsBtn} hitSlop={12}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </Pressable>
      </View>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          darkMode={darkMode}
          fontSize={fontSize}
          onToggleDark={() => setDarkMode((v) => !v)}
          onFontSizeChange={setFontSize}
          devMode={devMode}
          onToggleDev={() => setDevMode((v) => !v)}
          onCopyLogs={copyLogs}
          onViewLogs={() => setShowLogViewer(true)}
          canBuildIndex={canEbook && canAudio && mode === 'ebook' && book.ebookFormat === 'epub'}
          syncMapCreatedAt={book.session.positionMapCreatedAt}
          indexStatus={indexStatus}
          onBuildIndex={startBuildIndex}
          onRebuildIndex={handleRebuildIndex}
        />
      )}

      {/* Mode toggle tabs */}
      <View style={styles.modeTabs}>
        {canEbook && (
          <Pressable
            style={[styles.modeTab, activeMode === 'ebook' && styles.modeTabActive]}
            onPress={() => switchMode('ebook')}
          >
            <Text style={[styles.modeTabIcon, activeMode === 'ebook' && styles.modeTabIconActive]}>
              📖
            </Text>
            <Text style={[styles.modeTabLabel, activeMode === 'ebook' && styles.modeTabLabelActive]}>
              Read
            </Text>
          </Pressable>
        )}
        {canAudio && (
          <Pressable
            style={[styles.modeTab, activeMode === 'audio' && styles.modeTabActive]}
            onPress={() => switchMode('audio')}
          >
            <Text style={[styles.modeTabIcon, activeMode === 'audio' && styles.modeTabIconActive]}>
              🎧
            </Text>
            <Text style={[styles.modeTabLabel, activeMode === 'audio' && styles.modeTabLabelActive]}>
              Listen
            </Text>
          </Pressable>
        )}
      </View>

      {/* Sync banner */}
      {syncBanner && (
        <View style={styles.syncBanner}>
          <Text style={styles.syncBannerText}>
            {syncBanner.targetChapterIndex != null
              ? `Jump to "${syncBanner.targetChapterLabel ?? `chapter ${syncBanner.targetChapterIndex + 1}`}" — where you left off ${
                  syncBanner.targetMode === 'ebook' ? 'listening' : 'reading'
                }?`
              : `Jump to ${Math.round(syncBanner.percentage * 100)}% — where you left off ${
                  syncBanner.targetMode === 'ebook' ? 'listening' : 'reading'
                }?`}
          </Text>
          <View style={styles.syncBannerActions}>
            <Pressable testID="sync-banner-jump-btn" style={styles.syncAccept} onPress={handleSyncAccept}>
              <Text style={styles.syncAcceptText}>Jump</Text>
            </Pressable>
            <Pressable style={styles.syncDismiss} onPress={() => setSyncBanner(null)}>
              <Text style={styles.syncDismissText}>Skip</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Content */}
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {activeMode === 'ebook' && canEbook ? (
          <>
            <EbookReader
              uri={book.ebookUri!}
              format={book.ebookFormat!}
              savedPosition={book.session.ebookPosition}
              onPositionChange={handleEbookPositionChange}
              darkMode={darkMode}
              fontSize={fontSize}
              targetPercentage={epubTargetPercentage}
              targetChapter={epubTargetChapter}
              textExtractRequest={textExtractRequest}
              onTextExtracted={handleTextExtracted}
              goNextRequest={epubGoNextRequest}
              goPrevRequest={epubGoPrevRequest}
              autoScroll={autoScrollActive}
              scrollSpeed={scrollSpeed}
              onAutoScrollEnd={handleAutoScrollEnd}
              onLog={devMode ? handleLog : undefined}
            />
            {/* Floating prev-chapter button — bottom-left */}
            <View style={styles.chapterNavLeft} pointerEvents="box-none">
              <Pressable
                style={styles.chapterNavBtn}
                onPress={() => { setAutoScrollActive(false); setEpubGoPrevRequest((v) => v + 1); }}
              >
                <Text style={styles.chapterNavIcon}>‹</Text>
              </Pressable>
            </View>

            {/* Floating auto-scroll control — bottom-right of the reader */}
            <View style={styles.autoScrollBar} pointerEvents="box-none">
              <Pressable
                style={styles.chapterNavBtn}
                onPress={() => { setAutoScrollActive(false); setEpubGoNextRequest((v) => v + 1); }}
              >
                <Text style={styles.chapterNavIcon}>›</Text>
              </Pressable>
              {autoScrollActive && (
                <>
                  <Pressable
                    style={[styles.autoScrollSpeedBtn, scrollSpeed === 30 && styles.autoScrollSpeedBtnActive]}
                    onPress={() => setScrollSpeed(30)}
                  >
                    <Text style={styles.autoScrollSpeedText}>S</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.autoScrollSpeedBtn, scrollSpeed === 50 && styles.autoScrollSpeedBtnActive]}
                    onPress={() => setScrollSpeed(50)}
                  >
                    <Text style={styles.autoScrollSpeedText}>M</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.autoScrollSpeedBtn, scrollSpeed === 90 && styles.autoScrollSpeedBtnActive]}
                    onPress={() => setScrollSpeed(90)}
                  >
                    <Text style={styles.autoScrollSpeedText}>F</Text>
                  </Pressable>
                </>
              )}
              <Pressable
                style={[styles.autoScrollBtn, autoScrollActive && styles.autoScrollBtnActive]}
                onPress={() => setAutoScrollActive((v) => !v)}
              >
                <Text style={styles.autoScrollIcon}>{autoScrollActive ? '⏸' : '▶'}</Text>
              </Pressable>
            </View>
            {/* Compact audio strip while reading — if audio exists */}
            {canAudio && (
              <AudioPlayer
                key={audioPlayerKey}
                uris={book.audioUris!}
                fileIndex={book.session.audioFileIndex}
                savedPosition={book.session.audioPosition}
                onPositionChange={handleAudioPositionChange}
                onDurationLoaded={handleDurationLoaded}
                bookTitle={book.title}
                compact
              />
            )}
          </>
        ) : activeMode === 'audio' && canAudio ? (
          <AudioPlayer
            key={audioPlayerKey}
            uris={book.audioUris!}
            fileIndex={book.session.audioFileIndex}
            savedPosition={book.session.audioPosition}
            onPositionChange={handleAudioPositionChange}
            onDurationLoaded={handleDurationLoaded}
            bookTitle={book.title}
          />
        ) : null}
      </Animated.View>

      {/* Real-time log viewer */}
      {showLogViewer && (
        <LogViewer
          logs={logs}
          onClose={() => setShowLogViewer(false)}
          onCopy={copyLogs}
        />
      )}

      {/* Bottom safe area */}
      <View style={{ height: insets.bottom }} />
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// Settings panel
// ────────────────────────────────────────────────────────────
function SettingsPanel({
  darkMode,
  fontSize,
  onToggleDark,
  onFontSizeChange,
  devMode,
  onToggleDev,
  onCopyLogs,
  onViewLogs,
  canBuildIndex,
  syncMapCreatedAt,
  indexStatus,
  onBuildIndex,
  onRebuildIndex,
}: {
  darkMode: boolean;
  fontSize: number;
  onToggleDark: () => void;
  onFontSizeChange: (size: number) => void;
  devMode: boolean;
  onToggleDev: () => void;
  onCopyLogs: () => void;
  onViewLogs: () => void;
  canBuildIndex: boolean;
  syncMapCreatedAt?: number;
  indexStatus: IndexStatus | null;
  onBuildIndex: () => void;
  onRebuildIndex: () => void;
}) {
  const MIN = 14;
  const MAX = 28;
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    await onCopyLogs();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopyLogs]);

  const isIndexing = indexStatus != null &&
    indexStatus.phase !== 'done' &&
    indexStatus.phase !== 'error' &&
    indexStatus.phase !== 'idle';

  const indexLabel = React.useMemo(() => {
    if (!indexStatus) return null;
    switch (indexStatus.phase) {
      case 'extracting':    return 'Extracting text…';
      case 'downloading':   return `Downloading model… ${Math.round(indexStatus.progress * 100)}%`;
      case 'transcribing':  return `Transcribing file ${(indexStatus.transcribeFileIndex ?? 0) + 1}… ${Math.round(indexStatus.progress * 100)}%`;
      case 'aligning':      return 'Aligning words…';
      case 'done':          return null; // shown via syncMapCreatedAt
      case 'error':         return `Error: ${indexStatus.error}`;
      default:              return null;
    }
  }, [indexStatus]);

  return (
    <View style={settingsStyles.panel}>
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.label}>Dark Mode</Text>
        <Pressable
          style={[settingsStyles.toggle, darkMode && settingsStyles.toggleOn]}
          onPress={onToggleDark}
        >
          <View style={[settingsStyles.thumb, darkMode && settingsStyles.thumbOn]} />
        </Pressable>
      </View>

      <View style={settingsStyles.row}>
        <Text style={settingsStyles.label}>Font Size</Text>
        <View style={settingsStyles.sizeRow}>
          <Pressable
            style={settingsStyles.sizeBtn}
            onPress={() => onFontSizeChange(Math.max(MIN, fontSize - 2))}
          >
            <Text style={settingsStyles.sizeBtnText}>A−</Text>
          </Pressable>
          <Text style={settingsStyles.sizeValue}>{fontSize}</Text>
          <Pressable
            style={settingsStyles.sizeBtn}
            onPress={() => onFontSizeChange(Math.min(MAX, fontSize + 2))}
          >
            <Text style={settingsStyles.sizeBtnText}>A+</Text>
          </Pressable>
        </View>
      </View>

      {/* Word sync index */}
      {canBuildIndex && (
        <View style={settingsStyles.syncIndexSection}>
          <View style={settingsStyles.row}>
            <View style={{ flex: 1 }}>
              <Text style={settingsStyles.label}>Word Sync Index</Text>
              <Text style={settingsStyles.sublabel}>
                {syncMapCreatedAt
                  ? `Indexed ${new Date(syncMapCreatedAt).toLocaleDateString()}`
                  : 'Not yet indexed — enables chapter-accurate sync'}
              </Text>
              {indexLabel ? (
                <Text style={[settingsStyles.sublabel, settingsStyles.sublabelActive]}>
                  {indexLabel}
                </Text>
              ) : null}
            </View>
            {syncMapCreatedAt ? (
              <Pressable
                style={[settingsStyles.sizeBtn, isIndexing && settingsStyles.btnDisabled]}
                onPress={isIndexing ? undefined : onRebuildIndex}
              >
                <Text style={settingsStyles.sizeBtnText}>Rebuild</Text>
              </Pressable>
            ) : (
              <Pressable
                testID="settings-build-index-btn"
                style={[settingsStyles.copyLogsBtn, isIndexing && settingsStyles.btnDisabled]}
                onPress={isIndexing ? undefined : onBuildIndex}
              >
                <Text style={settingsStyles.copyLogsBtnText}>
                  {isIndexing ? 'Indexing…' : 'Build Index'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <View style={settingsStyles.row}>
        <Text style={settingsStyles.label}>Dev Logging</Text>
        <Pressable
          style={[settingsStyles.toggle, devMode && settingsStyles.toggleOn]}
          onPress={onToggleDev}
        >
          <View style={[settingsStyles.thumb, devMode && settingsStyles.thumbOn]} />
        </Pressable>
      </View>

      {devMode && (
        <View style={settingsStyles.devActions}>
          <Pressable style={settingsStyles.devBtn} onPress={onViewLogs}>
            <Text style={settingsStyles.devBtnText}>View Logs</Text>
          </Pressable>
          <Pressable style={settingsStyles.devBtn} onPress={handleCopy}>
            <Text style={settingsStyles.devBtnText}>{copied ? 'Copied!' : 'Copy Logs'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const settingsStyles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.small,
    color: colors.text,
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleOn: {
    backgroundColor: colors.primary,
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.white,
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sizeBtn: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sizeBtnText: {
    ...typography.small,
    color: colors.text,
    fontWeight: '700',
  },
  sizeValue: {
    ...typography.small,
    color: colors.textMuted,
    minWidth: 24,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  copyLogsBtn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  copyLogsBtnText: {
    ...typography.small,
    color: colors.primaryLight,
    fontWeight: '700',
  },
  syncIndexSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  sublabel: {
    ...typography.tiny,
    color: colors.textMuted,
    marginTop: 2,
  },
  sublabelActive: {
    color: colors.primaryLight,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  devActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  devBtn: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  devBtnText: {
    ...typography.small,
    color: colors.primaryLight,
    fontWeight: '700',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: {
    padding: spacing.xs,
    minWidth: 36,
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 28,
    color: colors.text,
    lineHeight: 32,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    ...typography.small,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerAuthor: {
    ...typography.tiny,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 1,
  },
  settingsBtn: {
    padding: spacing.xs,
    minWidth: 36,
    alignItems: 'center',
  },
  settingsIcon: {
    fontSize: 20,
    color: colors.textMuted,
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  modeTabActive: {
    borderBottomColor: colors.primary,
  },
  modeTabIcon: {
    fontSize: 16,
  },
  modeTabIconActive: {},
  modeTabLabel: {
    ...typography.small,
    color: colors.textMuted,
    fontWeight: '600',
  },
  modeTabLabelActive: {
    color: colors.primary,
  },
  content: {
    flex: 1,
    position: 'relative',
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryDim,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  syncBannerText: {
    ...typography.small,
    color: colors.primaryLight,
    flex: 1,
  },
  syncBannerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  syncAccept: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  syncAcceptText: {
    ...typography.small,
    color: colors.white,
    fontWeight: '700',
  },
  syncDismiss: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  syncDismissText: {
    ...typography.small,
    color: colors.textMuted,
  },
  chapterNavLeft: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.lg,
    zIndex: 20,
  },
  chapterNavBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(30,20,50,0.75)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterNavIcon: {
    fontSize: 22,
    color: colors.text,
    lineHeight: 26,
  },
  autoScrollBar: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    zIndex: 20,
  },
  autoScrollBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(30,20,50,0.75)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoScrollBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  autoScrollIcon: {
    fontSize: 18,
    color: colors.white,
  },
  autoScrollSpeedBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(30,20,50,0.75)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoScrollSpeedBtnActive: {
    borderColor: colors.primaryLight,
  },
  autoScrollSpeedText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
});

// ────────────────────────────────────────────────────────────
// Real-time log viewer (tail -f style)
// ────────────────────────────────────────────────────────────
function LogViewer({
  logs,
  onClose,
  onCopy,
}: {
  logs: string[];
  onClose: () => void;
  onCopy: () => Promise<void>;
}) {
  const flatListRef = useRef<FlatList>(null);
  const [copied, setCopied] = React.useState(false);
  const insets = useSafeAreaInsets();

  const handleCopy = React.useCallback(async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopy]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[logStyles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={logStyles.header}>
          <Text style={logStyles.title}>Logs</Text>
          <View style={logStyles.headerActions}>
            <Pressable style={logStyles.headerBtn} onPress={handleCopy}>
              <Text style={logStyles.headerBtnText}>{copied ? 'Copied!' : 'Copy'}</Text>
            </Pressable>
            <Pressable style={logStyles.headerBtn} onPress={onClose}>
              <Text style={logStyles.headerBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>

        {/* Log entries — auto-scrolls to bottom on new entries */}
        {logs.length === 0 ? (
          <View style={logStyles.empty}>
            <Text style={logStyles.emptyText}>No logs yet. Enable Dev Logging to capture output.</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={logs}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => <Text style={logStyles.entry}>{item}</Text>}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
            contentContainerStyle={logStyles.listContent}
            style={logStyles.list}
          />
        )}

        <View style={{ height: insets.bottom }} />
      </View>
    </Modal>
  );
}

const logStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerBtn: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  headerBtnText: {
    ...typography.small,
    color: colors.primaryLight,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing.sm,
    gap: 2,
  },
  entry: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#A0E0A0',
    lineHeight: 16,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
