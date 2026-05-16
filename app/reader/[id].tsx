import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  AppStateStatus,
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
import { SPEED_LEVELS } from '../../src/components/EbookReader/EpubReader';
import { useLibraryStore } from '../../src/store/libraryStore';
import { useStatsStore } from '../../src/store/statsStore';
import { colors, radius, spacing, typography } from '../../src/theme';
import type { EbookPosition, PositionAnchor, PositionMap, ReaderMode } from '../../src/types';
import { buildSyncPoints, buildSyncPointsFromTranscripts, fillFilePositions, findChapterByWindowText, lookupByAudio, lookupByChapter, type ChapterText } from '../../src/utils/alignSync';
import { downloadModel, isModelDownloaded, releaseWhisperContext, transcribeFile, transcribeWindow } from '../../src/utils/transcribeAudio';
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

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { getBook, updateEbookPosition, updateAudioPosition, updateAudioFileDuration, setLastMode, setPositionMapCreatedAt } =
    useLibraryStore();
  const { startSession, endSession, markBookCompleted } = useStatsStore();
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
  const [scrollSpeed, setScrollSpeed] = useState(50); // px/s (user-set)
  const [effectiveScrollSpeed, setEffectiveScrollSpeed] = useState(50); // actual speed from WebView (may differ due to auto-density)
  const [epubGoNextRequest, setEpubGoNextRequest] = useState(0);
  const [epubGoPrevRequest, setEpubGoPrevRequest] = useState(0);
  const [chapterProgressFraction, setChapterProgressFraction] = useState(0); // 0-1 through current chapter
  const [currentChapterSpineIdx, setCurrentChapterSpineIdx] = useState(-1);
  const [speedDialLevel, setSpeedDialLevel] = useState(2); // index into SPEED_LEVELS: 0=30, 1=40, 2=50, 3=65, 4=85
  const speedDialBounce = useRef(new Animated.Value(1)).current;
  const controlBarOpacity = useRef(new Animated.Value(1)).current;
  const controlBarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logsRef = useRef<string[]>([]);
  const sessionRef = useRef<string | null>(null);

  // Position map (word-level audio↔ebook alignment)
  const [positionMap, setPositionMap] = useState<PositionMap | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  /** Increment to trigger epub text extraction from the WebView */
  const [textExtractRequest, setTextExtractRequest] = useState(0);
  /** Set to true when component unmounts or book changes — cancels in-flight indexing */
  const indexCancelledRef = useRef(false);
  /** Accumulated chapter texts from epub — filled when textExtracted fires */
  const chaptersRef = useRef<ChapterText[]>([]);

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

  // ── Session tracking ────────────────────────────────────────
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartPosRef = useRef<number>(0);
  const sessionStartPageRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!book) return;

    // End previous session if any
    if (sessionIdRef.current) {
      const b = bookRef.current ?? book;
      const endPos =
        mode === 'ebook'
          ? b.session.ebookPosition.percentage
          : b.session.audioFileDurations
              .slice(0, b.session.audioFileIndex)
              .reduce((s, d) => s + (d ?? 0), 0) + b.session.audioPosition;
      endSession(
        sessionIdRef.current,
        endPos,
      );
    }

    // Compute start position for new session
    const startPos =
      mode === 'ebook'
        ? book.session.ebookPosition.percentage
        : book.session.audioFileDurations
            .slice(0, book.session.audioFileIndex)
            .reduce((s, d) => s + (d ?? 0), 0) + book.session.audioPosition;

    sessionStartPosRef.current = startPos;
    sessionStartPageRef.current = book.session.ebookPosition.page;
    sessionIdRef.current = startSession(book.id, mode, startPos);

    return () => {
      // End session on unmount
      if (sessionIdRef.current) {
        const b = bookRef.current ?? book;
        const endPos =
          mode === 'ebook'
            ? b.session.ebookPosition.percentage
            : b.session.audioFileDurations
                .slice(0, b.session.audioFileIndex)
                .reduce((s, d) => s + (d ?? 0), 0) + b.session.audioPosition;
        endSession(
          sessionIdRef.current,
          endPos,
        );
        sessionIdRef.current = null;
      }
    };
  }, [book?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Load persisted position map and chapter texts when the book changes
  useEffect(() => {
    if (!book?.id) return;
    loadPositionMap(book.id).then((map) => {
      if (map) setPositionMap(map);
    });
    loadChapterTexts(book.id).then((texts) => {
      if (texts?.length) chaptersRef.current = texts;
    });
  }, [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Session tracking: start on mount, end on unmount
  useEffect(() => {
    if (!book) return;
    const chapterIndex = book.session.ebookPosition.spineIndex ?? -1;
    const sessionId = startSession(book.id, mode, chapterIndex);
    sessionRef.current = sessionId;
    return () => {
      if (sessionRef.current) {
        const endChapter = bookRef.current?.session.ebookPosition.spineIndex ?? -1;
        endSession(sessionRef.current, endChapter);
        sessionRef.current = null;
      }
    };
  }, [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // AppState: end session on background, restart on foreground
  useEffect(() => {
    const handleChange = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (sessionRef.current) {
          const endChapter = bookRef.current?.session.ebookPosition.spineIndex ?? -1;
          endSession(sessionRef.current, endChapter);
          sessionRef.current = null;
        }
      } else if (nextState === 'active') {
        if (!sessionRef.current && bookRef.current) {
          const chapterIndex = bookRef.current.session.ebookPosition.spineIndex ?? -1;
          sessionRef.current = startSession(bookRef.current.id, mode, chapterIndex);
        }
      }
    };
    const sub = AppState.addEventListener('change', handleChange);
    return () => sub.remove();
  }, [mode, startSession, endSession]);

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
        // We derive per-file durations from the whisper segments themselves (last segment t1Ms)
        // rather than from audioFileDurations in the store, which may be unpopulated for files
        // the user hasn't played yet.
        const audioUris = b.audioUris!;
        const actualFileDurationsMs: number[] = [];
        const fileTranscripts: string[] = []; // one plain-text string per audio file
        let cumulativeMs = 0;
        const allSegments: Awaited<ReturnType<typeof transcribeFile>> = [];

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
          actualFileDurationsMs.push(fileDurationMs);
          // Collect the full transcript text for this file (used in content-based alignment)
          fileTranscripts.push(segs.map((s) => s.text).join(' ').trim());

          // Offset segment timestamps so they're relative to the whole audiobook
          for (const s of segs) {
            allSegments.push({ ...s, t0Ms: s.t0Ms + cumulativeMs, t1Ms: s.t1Ms + cumulativeMs });
          }
          cumulativeMs += fileDurationMs;
        }

        releaseWhisperContext();
        if (indexCancelledRef.current) return;

        handleLog(`[index] aligning ${fileTranscripts.length} audio files to ${chapters.length} chapters by transcript search…`);
        setIndexStatus({ phase: 'aligning', progress: 0 });

        // Diagnostic: check transcript and chapter text quality before alignment
        {
          const tokenize = (t: string) => new Set((t.toLowerCase().match(/\b[a-z']{2,}\b/g) ?? []));
          const contentChs = chaptersRef.current.filter((c) => c.text.trim().length >= 500);
          const chWordSets = contentChs.map((c) => ({ label: c.label, words: tokenize(c.text) }));

          // Log summary for every file + best chapter score
          let emptyCount = 0;
          for (let fi = 0; fi < fileTranscripts.length; fi++) {
            const t = fileTranscripts[fi] ?? '';
            if (!t.trim()) { emptyCount++; continue; }
            const tWords = tokenize(t);
            if (tWords.size === 0) { emptyCount++; continue; }
            let bestScore = 0;
            let bestLabel = 'none';
            for (const { label, words } of chWordSets) {
              let hits = 0;
              for (const w of tWords) { if (words.has(w)) hits++; }
              const score = hits / tWords.size;
              if (score > bestScore) { bestScore = score; bestLabel = label ?? '?'; }
            }
            handleLog(
              `[index] diag file${fi}: len=${t.length} tokens=${tWords.size} sample="${t.slice(0, 60)}" bestChap="${bestLabel}" bestScore=${bestScore.toFixed(3)}`,
            );
          }
          if (emptyCount > 0) handleLog(`[index] warning: ${emptyCount}/${fileTranscripts.length} files produced empty/blank transcripts`);
        }

        let points = buildSyncPointsFromTranscripts(fileTranscripts, actualFileDurationsMs, chaptersRef.current);
        const contentChapterCount = chaptersRef.current.filter((c) => c.text.trim().length >= 500).length;
        const uniqueChapters = new Set(points.map((p) => p.chapterIndex)).size;

        if (points.length === 0 || (uniqueChapters <= 1 && contentChapterCount > 3)) {
          // Transcript search failed (empty transcripts or all files matched same chapter).
          // Fall back to proportional text-length mapping.
          handleLog(`[index] transcript search degenerate (${uniqueChapters} unique chapters), falling back to proportional mapping`);
          const propPoints = buildSyncPoints(allSegments, chaptersRef.current, cumulativeMs, { equalAllocation: true });
          points = fillFilePositions(propPoints, actualFileDurationsMs);
          const uniqueChaptersFallback = new Set(points.map((p) => p.chapterIndex)).size;
          handleLog(`[index] alignment done (proportional) — ${points.length} sync points spanning ${uniqueChaptersFallback} chapters`);
        } else {
          handleLog(`[index] alignment done — ${points.length} sync points spanning ${uniqueChapters} chapters`);
        }

        if (indexCancelledRef.current) return;

        const map: PositionMap = {
          bookId: b.id,
          createdAt: Date.now(),
          totalAudioMs: cumulativeMs,
          anchors: points,
        };
        await savePositionMap(map);
        await deleteTranscriptionCache(b.id);
        await saveChapterTexts(b.id, chapters);
        setPositionMapCreatedAt(b.id, map.createdAt);
        setPositionMap(map);
        setIndexStatus({ phase: 'done', progress: 1 });
        handleLog('[index] position map saved ✓');
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
    if (mode !== 'ebook') return; // EpubReader must be mounted
    setIndexStatus({ phase: 'extracting', progress: 0 });
    setTextExtractRequest((n) => n + 1);
  }, [mode]);

  const handleRebuildIndex = useCallback(async () => {
    const b = bookRef.current;
    if (!b) return;
    await Promise.all([deletePositionMap(b.id), deleteTranscriptionCache(b.id), deleteChapterTexts(b.id)]);
    setPositionMapCreatedAt(b.id, undefined);
    setPositionMap(null);
    setIndexStatus(null);
  }, [setPositionMapCreatedAt]);

  const switchMode = useCallback(
    (next: ReaderMode) => {
      if (next === mode) return;

      const b = bookRef.current;
      if (b) {
        const durations = b.session.audioFileDurations ?? [];
        // Use ?? 0 so sparse/missing entries don't produce NaN
        const totalDuration = durations.reduce((s, d) => s + (d ?? 0), 0);

        if (mode === 'audio' && next === 'ebook' && totalDuration > 0) {
          const elapsed =
            durations.slice(0, b.session.audioFileIndex).reduce((s, d) => s + (d ?? 0), 0) +
            b.session.audioPosition;
          const pct = Math.min(elapsed / totalDuration, 1);

          // Prefer position-map chapter lookup over raw percentage
          const currentMap = positionMap;
          if (currentMap?.anchors.length && pct > 0.01) {
            const currentAudioMs = elapsed * 1000;
            const pt = lookupByAudio(currentMap.anchors, currentAudioMs);
            handleLog(
              `[sync] lookup: fileIdx=${b.session.audioFileIndex} pos=${b.session.audioPosition.toFixed(1)}s` +
              ` elapsed=${elapsed.toFixed(0)}s currentAudioMs=${currentAudioMs}` +
              ` mapTotalMs=${currentMap.totalAudioMs} anchors=${currentMap.anchors.length}` +
              ` firstPtMs=${currentMap.anchors[0]?.audioMs} lastPtMs=${currentMap.anchors[currentMap.anchors.length - 1]?.audioMs}` +
              ` → ch=${pt?.chapterIndex ?? 'null'}`,
            );
            if (pt) {
              const chLabel = chaptersRef.current.find((c) => c.chapterIndex === pt.chapterIndex)?.label;
              setSyncBanner({ targetMode: 'ebook', percentage: pct, targetChapterIndex: pt.chapterIndex, targetChapterLabel: chLabel });

              // JIT refine: use the cached transcript segments for the current file
              // to extract text near the current playback position, then match against
              // chapter texts.  This avoids re-transcribing the audio (which can fail
              // for some formats) and is instant since the segments are already cached.
              const posMs = b.session.audioPosition * 1000;
              const windowStartMs = Math.max(0, posMs - 7500);
              const windowEndMs = posMs + 7500;
              const fileIdx = b.session.audioFileIndex;
              const bookId = b.id;
              loadCachedFileSegments(bookId, fileIdx)
                .then((cachedSegs) => {
                  if (!cachedSegs?.length) return;
                  // Extract segments that overlap the ±7.5s window around current position
                  const windowText = cachedSegs
                    .filter((s) => s.t1Ms >= windowStartMs && s.t0Ms <= windowEndMs)
                    .map((s) => s.text)
                    .join(' ')
                    .trim();
                  if (!windowText) return;
                  return loadChapterTexts(bookId).then((chapterTexts) => {
                    if (!chapterTexts?.length) return;
                    const jitChapter = findChapterByWindowText(windowText, chapterTexts);
                    handleLog(`[sync] JIT result: "${windowText.slice(0, 60)}…" → ch=${jitChapter ?? 'no match'}`);
                    if (jitChapter != null) {
                      const jitLabel = chapterTexts.find((c) => c.chapterIndex === jitChapter)?.label;
                      setSyncBanner((prev) =>
                        prev ? { ...prev, targetChapterIndex: jitChapter, targetChapterLabel: jitLabel } : prev,
                      );
                    }
                  });
                })
                .catch((err) => handleLog(`[sync] JIT scan error: ${err}`));
            }
          } else if (pct > 0.01) {
            setSyncBanner({ targetMode: 'ebook', percentage: pct });
          }
        } else if (mode === 'ebook' && next === 'audio' && totalDuration > 0) {
          const pct = b.session.ebookPosition.percentage;
          const spineIndex = b.session.ebookPosition.spineIndex ?? -1;
          // Allow sync when we have a valid spine index even if pct is 0
          // (scrolled-doc mode may report pct=0 until locations are generated)
          if (spineIndex >= 0 || pct > 0.01) {
            const currentMap = positionMap;
            // Prefer position-map lookup by spine/chapter index (accurate)
            if (currentMap?.anchors.length && spineIndex >= 0) {
              const pt = lookupByChapter(currentMap.anchors, spineIndex);
              if (pt) {
                // Re-derive file position from pt.audioMs using the session's actual
                // file durations rather than the pre-computed fileIndex/fileSeconds stored
                // in the sync map (those were computed from whisper timestamps which can
                // be truncated for long mp4 files, producing badly wrong file positions).
                let targetFileIndex = durations.length - 1;
                let targetSeconds = durations[durations.length - 1] ?? 0;
                let cum = 0;
                for (let i = 0; i < durations.length; i++) {
                  const d = (durations[i] ?? 0) * 1000;
                  if (cum + d > pt.audioMs) {
                    targetFileIndex = i;
                    targetSeconds = (pt.audioMs - cum) / 1000;
                    break;
                  }
                  cum += d;
                }
                handleLog(`[sync] ebook→audio: spineIdx=${spineIndex} audioMs=${pt.audioMs} → fileIdx=${targetFileIndex} fileSeconds=${targetSeconds.toFixed(1)}`);
                setSyncBanner({
                  targetMode: 'audio',
                  percentage: pct,
                  targetFileIndex,
                  targetSeconds,
                });
              } else {
                setSyncBanner({ targetMode: 'audio', percentage: pct });
              }
            } else {
              // Fallback: percentage × total duration (no sync map or no spine info yet)
              handleLog(`[sync] ebook→audio: no sync map or spineIndex, using pct=${pct.toFixed(3)}`);
              const targetElapsed = pct * totalDuration;
              let cumulative = 0;
              let targetFileIndex = durations.length - 1;
              let targetSeconds = durations[durations.length - 1] ?? 0;
              for (let i = 0; i < durations.length; i++) {
                const d = durations[i] ?? 0;
                if (cumulative + d >= targetElapsed) {
                  targetFileIndex = i;
                  targetSeconds = targetElapsed - cumulative;
                  break;
                }
                cumulative += d;
              }
              setSyncBanner({ targetMode: 'audio', percentage: pct, targetFileIndex, targetSeconds });
            }
          }
        }
      }

      // Clear epub jump targets when leaving ebook — prevents stale values
      // from re-triggering when EbookReader remounts on next visit
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
    [mode, fadeAnim],
  );

  const handleSyncAccept = useCallback(() => {
    const b = bookRef.current;
    if (!syncBanner || !b) return;
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
  }, [syncBanner, updateAudioPosition]);

  const handleEbookPositionChange = useCallback(
    (position: Partial<EbookPosition>) => {
      if (!book) return;
      updateEbookPosition(book.id, position);
      if (
        position.percentage !== undefined &&
        position.percentage > 0.95
      ) {
        markBookCompleted(book.id);
      }
    },
    [book, updateEbookPosition, markBookCompleted],
  );

  const handleAudioPositionChange = useCallback(
    (fileIndex: number, seconds: number) => {
      if (book) updateAudioPosition(book.id, fileIndex, seconds);
    },
    [book, updateAudioPosition],
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

  // ── Control bar auto-hide ─────────────────────────────────────────────────
  const showControlBar = useCallback(() => {
    Animated.timing(controlBarOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    if (controlBarTimeoutRef.current) clearTimeout(controlBarTimeoutRef.current);
    controlBarTimeoutRef.current = setTimeout(() => {
      Animated.timing(controlBarOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }, 3000);
  }, [controlBarOpacity]);

  // Show controls initially and on mount
  useEffect(() => {
    showControlBar();
    return () => {
      if (controlBarTimeoutRef.current) clearTimeout(controlBarTimeoutRef.current);
    };
  }, [showControlBar]);

  // ── New event handlers ────────────────────────────────────────────────────
  const handleScrollSpeedChanged = useCallback((speed: number) => {
    setEffectiveScrollSpeed(speed);
  }, []);

  const handleChapterProgress = useCallback((_spineIndex: number, fraction: number) => {
    setChapterProgressFraction(fraction);
  }, []);

  const handleChapterTransition = useCallback((spineIndex: number) => {
    setCurrentChapterSpineIdx(spineIndex);
    setChapterProgressFraction(0);
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch (_) {}
  }, []);

  const handleTapPause = useCallback(() => {
    setAutoScrollActive(false);
    showControlBar();
  }, [showControlBar]);

  const handleTapResume = useCallback(() => {
    setAutoScrollActive(true);
    showControlBar();
  }, [showControlBar]);

  const handlePeekBack = useCallback(() => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch (_) {}
  }, []);

  const handleSwipeSpeedAdjust = useCallback((delta: number) => {
    // delta is +1 (faster) or -1 (slower)
    const currentIdx = SPEED_LEVELS.indexOf(
      SPEED_LEVELS.reduce((prev, curr) =>
        Math.abs(curr - effectiveScrollSpeed) < Math.abs(prev - effectiveScrollSpeed) ? curr : prev
      )
    );
    const newIdx = Math.max(0, Math.min(SPEED_LEVELS.length - 1, currentIdx + delta));
    const newSpeed = SPEED_LEVELS[newIdx];
    setScrollSpeed(newSpeed);
    setSpeedDialLevel(newIdx);
    setEffectiveScrollSpeed(newSpeed);
    showControlBar();
    // Bounce the dial
    Animated.sequence([
      Animated.spring(speedDialBounce, { toValue: 1.3, useNativeDriver: true, speed: 20 }),
      Animated.spring(speedDialBounce, { toValue: 1, useNativeDriver: true, speed: 10 }),
    ]).start();
  }, [effectiveScrollSpeed, speedDialBounce, showControlBar]);

  // Sync speedDialLevel when scrollSpeed prop changes externally
  useEffect(() => {
    const idx = SPEED_LEVELS.indexOf(scrollSpeed);
    if (idx >= 0) setSpeedDialLevel(idx);
  }, [scrollSpeed]);

  // ── Speed dial tap cycle ─────────────────────────────────────────────────
  const cycleSpeed = useCallback(() => {
    const nextLevel = (speedDialLevel + 1) % SPEED_LEVELS.length;
    const newSpeed = SPEED_LEVELS[nextLevel];
    setSpeedDialLevel(nextLevel);
    setScrollSpeed(newSpeed);
    setEffectiveScrollSpeed(newSpeed);
    showControlBar();
    try { Haptics.selectionAsync(); } catch (_) {}
    // Bounce animation
    Animated.sequence([
      Animated.spring(speedDialBounce, { toValue: 1.3, useNativeDriver: true, speed: 20 }),
      Animated.spring(speedDialBounce, { toValue: 1, useNativeDriver: true, speed: 10 }),
    ]).start();
  }, [speedDialLevel, speedDialBounce, showControlBar]);

  // Derived WPM estimate (rough: ~20 words per px/s at typical font size)
  const estimatedWpm = Math.round(effectiveScrollSpeed * 20);

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
          canBuildIndex={canEbook && canAudio && mode === 'ebook'}
          positionMapCreatedAt={book.session.positionMapCreatedAt}
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
              onScrollSpeedChanged={handleScrollSpeedChanged}
              onChapterProgress={handleChapterProgress}
              onChapterTransition={handleChapterTransition}
              onTapPause={handleTapPause}
              onTapResume={handleTapResume}
              onPeekBack={handlePeekBack}
              swipeSpeedAdjust={autoScrollActive}
              onSwipeSpeedAdjust={handleSwipeSpeedAdjust}
            />
            {/* Floating chapter nav + auto-scroll controls — bottom */}
            <Animated.View style={[styles.controlBar, { opacity: controlBarOpacity }]} pointerEvents="box-none">
              {/* Prev chapter — left */}
              <Pressable
                style={styles.chapterNavBtn}
                onPress={() => { setAutoScrollActive(false); setEpubGoPrevRequest((v) => v + 1); showControlBar(); }}
              >
                <Text style={styles.chapterNavIcon}>‹</Text>
              </Pressable>

              {/* Center cluster: speed dial, WPM, play/pause */}
              <View style={styles.controlCluster}>
                {autoScrollActive && (
                  <View style={styles.wpmContainer}>
                    <Text style={styles.wpmLabel}>WPM</Text>
                    <Text style={styles.wpmValue}>{estimatedWpm}</Text>
                  </View>
                )}

                {/* Speed dial — single button that cycles speeds */}
                <Animated.View style={{ transform: [{ scale: speedDialBounce }] }}>
                  <Pressable
                    style={[styles.speedDial, autoScrollActive && styles.speedDialActive]}
                    onPress={cycleSpeed}
                  >
                    <Text style={styles.speedDialText}>
                      {autoScrollActive ? SPEED_LEVELS[speedDialLevel] : '—'}
                    </Text>
                    {autoScrollActive && <Text style={styles.speedDialUnit}>px/s</Text>}
                  </Pressable>
                </Animated.View>

                {/* Play/Pause */}
                <Pressable
                  style={[styles.autoScrollBtn, autoScrollActive && styles.autoScrollBtnActive]}
                  onPress={() => { setAutoScrollActive((v) => !v); showControlBar(); }}
                >
                  <Text style={styles.autoScrollIcon}>{autoScrollActive ? '⏸' : '▶'}</Text>
                </Pressable>
              </View>

              {/* Next chapter — right */}
              <Pressable
                style={styles.chapterNavBtn}
                onPress={() => { setAutoScrollActive(false); setEpubGoNextRequest((v) => v + 1); showControlBar(); }}
              >
                <Text style={styles.chapterNavIcon}>›</Text>
              </Pressable>
            </Animated.View>

            {/* Chapter progress ring — right edge */}
            {autoScrollActive && (
              <View style={styles.progressRingContainer} pointerEvents="none">
                <View style={styles.progressRingTrack}>
                  <View
                    style={[
                      styles.progressRingFill,
                      { transform: [{ rotate: chapterProgressFraction * 360 + 'deg' }] },
                    ]}
                  />
                  <View style={styles.progressRingCenter} />
                </View>
                <Text style={styles.progressPercent}>
                  {Math.round(chapterProgressFraction * 100)}%
                </Text>
              </View>
            )}
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
  positionMapCreatedAt,
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
  positionMapCreatedAt?: number;
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
      case 'done':          return null; // shown via positionMapCreatedAt
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
                {positionMapCreatedAt
                  ? `Indexed ${new Date(positionMapCreatedAt).toLocaleDateString()}`
                  : 'Using proportional sync. Transcribe audio for higher precision.'}
              </Text>
              {indexLabel ? (
                <Text style={[settingsStyles.sublabel, settingsStyles.sublabelActive]}>
                  {indexLabel}
                </Text>
              ) : null}
            </View>
            {positionMapCreatedAt ? (
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
  // ── Control bar (auto-hiding) ───────────────────────────────────────────
  controlBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    zIndex: 20,
  },
  controlCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // ── Speed dial ───────────────────────────────────────────────────────────
  speedDial: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(30,20,50,0.85)',
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedDialActive: {
    borderColor: colors.primaryLight,
  },
  speedDialText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
  },
  speedDialUnit: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: -2,
  },
  // ── WPM indicator ────────────────────────────────────────────────────────
  wpmContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30,20,50,0.75)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  wpmLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  wpmValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  // ── Chapter progress ring ────────────────────────────────────────────────
  progressRingContainer: {
    position: 'absolute',
    right: spacing.xs,
    top: '40%',
    zIndex: 10,
    alignItems: 'center',
    gap: 2,
  },
  progressRingTrack: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: 'rgba(124,58,237,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingFill: {
    position: 'absolute',
    top: -3,
    left: -3,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: colors.primary,
  },
  progressRingCenter: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface,
  },
  progressPercent: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  // ── Shared control buttons ───────────────────────────────────────────────
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
  },});

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
