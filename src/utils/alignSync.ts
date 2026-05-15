/**
 * Audio↔ebook alignment.
 *
 * Takes word-level Whisper transcript segments and epub chapter texts,
 * produces a SyncMap: a sorted list of (audioMs → chapterIndex) points.
 *
 * Algorithm: proportional text-length mapping.
 * Each non-empty chapter is assumed to occupy an audio time range
 * proportional to its share of total book text length. This is narrator-
 * rate-agnostic and works without complex vocabulary matching.
 *
 * A Jaccard sliding window approach was tried first but failed in practice
 * because: (a) chapter vocabulary sets are far larger than 30-second windows
 * (Jaccard penalises large sets heavily), and (b) shared proper nouns across
 * chapters make relative scores indistinguishable.
 */

import type { SyncPoint } from '../types';
import type { TranscribeSegment } from './transcribeAudio';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChapterText {
  chapterIndex: number;
  /** Full plain text of the chapter (whitespace-normalised) */
  text: string;
  /** TOC label (chapter title) — used for logging and back-matter detection */
  label?: string;
}

// ─── Core alignment ──────────────────────────────────────────────────────────

/**
 * Build a list of sync points from chapter texts and total audio duration.
 *
 * Each non-empty chapter gets one sync point whose audioMs is derived by
 * dividing the timeline either proportionally by chapter text length (default)
 * or equally per chapter (opts.equalAllocation = true).
 *
 * Equal allocation is more accurate when the audiobook uses a constant
 * narration rate regardless of chapter length (which is the common case).
 * Text-length allocation is only better when chapter lengths vary by 10×+
 * and narration rate is known to track text length.
 *
 * @param segments  Word-level segments (used only to derive totalMs if caller
 *                  passes 0; otherwise unused in the proportional algorithm)
 * @param chapters  Epub chapter texts (chapterIndex = spine index, 0-based)
 * @param totalMs   Total audiobook duration in ms
 * @param opts      { equalAllocation?: boolean }
 */
export function buildSyncPoints(
  segments: TranscribeSegment[],
  chapters: ChapterText[],
  totalMs: number,
  opts?: { equalAllocation?: boolean },
): SyncPoint[] {
  // Fall back to segment-derived duration if caller could not supply totalMs
  const effectiveTotalMs =
    totalMs > 0
      ? totalMs
      : segments.length > 0
        ? Math.max(...segments.map((s) => s.t1Ms))
        : 0;

  if (!effectiveTotalMs || !chapters.length) return [];

  // Only chapters with substantial text contribute to the timeline.
  // Threshold of 500 chars filters out part-header pages, copyright pages,
  // and other spine items that are just titles/headings with no real content.
  const contentChapters = chapters.filter((c) => c.text.trim().length >= 500);
  if (!contentChapters.length) return [];

  const n = contentChapters.length;
  const useEqual = opts?.equalAllocation ?? false;
  const totalChars = useEqual ? 0 : contentChapters.reduce((sum, c) => sum + c.text.length, 0);
  if (!useEqual && !totalChars) return [];

  const points: SyncPoint[] = [];
  let cumChars = 0;

  for (let i = 0; i < n; i++) {
    const chapter = contentChapters[i];
    const audioMs = useEqual
      ? Math.round((i / n) * effectiveTotalMs)
      : Math.round((cumChars / totalChars) * effectiveTotalMs);
    points.push({
      audioMs,
      fileIndex: 0,          // filled in by fillFilePositions()
      fileSeconds: 0,
      chapterIndex: chapter.chapterIndex,
      withinChapterFraction: 0,
    });
    if (!useEqual) cumChars += chapter.text.length;
  }

  return points;
}

// ─── Transcript-based alignment ──────────────────────────────────────────────

const tokenizeWords = (t: string): string[] => t.toLowerCase().match(/\b[a-z']{2,}\b/g) ?? [];

/**
 * Build a sync map by matching each audio file's full transcript against epub
 * chapters.  This is far more accurate than proportional mapping because it
 * uses actual content overlap rather than assuming narrator speed is constant.
 *
 * Algorithm:
 *  - Pre-build a word-set for every chapter (O(Σ chapter text))
 *  - For each audio file, use audio position to estimate which chapter ordinal
 *    we should be near (proportional bounding), then score every chapter within
 *    ±30% (min ±3) of that estimate using vocab recall
 *  - Assign the highest-scoring chapter; enforce monotonic ordering so the
 *    chapter index can never go backward
 *  - If no chapter exceeds the recall threshold, keep the last assignment
 *
 * The proportional bound prevents early/common chapters from "winning" for
 * files deep into the audiobook, while vocabulary matching provides precision
 * within that window.
 *
 * Returns one SyncPoint per audio file (at the file's start position).
 */
export function buildSyncPointsFromTranscripts(
  fileTranscripts: string[],
  fileDurationsMs: number[],
  chapters: ChapterText[],
): SyncPoint[] {
  const contentChapters = chapters.filter((c) => c.text.trim().length >= 500);
  if (!contentChapters.length || !fileTranscripts.length) return [];

  // Pre-build word sets for each chapter — reused for every file lookup
  const chapterWordSets = contentChapters.map((c) => new Set(tokenizeWords(c.text)));

  const n = contentChapters.length;
  const totalAudioMs = fileDurationsMs.reduce((s, d) => s + (d ?? 0), 0);
  // Half-window: ±30% of chapter count, but never less than 3 either side
  const halfWindow = Math.max(3, Math.ceil(n * 0.3));

  const points: SyncPoint[] = [];
  let cumulativeMs = 0;
  let lastOrdinal = 0; // ordinal position in contentChapters array (monotonic)

  for (let fileIdx = 0; fileIdx < fileTranscripts.length; fileIdx++) {
    const transcript = fileTranscripts[fileIdx];
    const durationMs = fileDurationsMs[fileIdx] ?? 0;

    if (transcript.trim().length > 0) {
      const transcriptWords = new Set(tokenizeWords(transcript));

      if (transcriptWords.size > 0) {
        // Proportional estimate of where we should be in the chapter list
        const audioPct = totalAudioMs > 0 ? cumulativeMs / totalAudioMs : 0;
        const expectedOrdinal = Math.round(audioPct * n);

        // Search range: at/after lastOrdinal AND within ±halfWindow of expected
        const searchLo = Math.max(lastOrdinal, Math.max(0, expectedOrdinal - halfWindow));
        const searchHi = Math.min(n - 1, expectedOrdinal + halfWindow);

        let bestOrdinal = lastOrdinal;
        let bestScore = -1;

        for (let ci = searchLo; ci <= searchHi; ci++) {
          const chWords = chapterWordSets[ci];
          let hits = 0;
          for (const w of transcriptWords) {
            if (chWords.has(w)) hits++;
          }
          const score = hits / transcriptWords.size;
          if (score > bestScore) {
            bestScore = score;
            bestOrdinal = ci;
          }
        }

        // Threshold kept low (0.05) because audio files span multiple chapters
        // and common vocabulary alone can push recall past 0.2 for the right chapter.
        if (bestScore >= 0.05) {
          lastOrdinal = bestOrdinal;
        }
      }
    }

    points.push({
      audioMs: cumulativeMs,
      fileIndex: fileIdx,
      fileSeconds: 0,
      chapterIndex: contentChapters[lastOrdinal].chapterIndex,
      withinChapterFraction: 0,
    });

    cumulativeMs += durationMs;
  }

  return points;
}

/**
 * Populate fileIndex and fileSeconds on each SyncPoint from cumulative durations.
 * @param fileDurationsMs  Duration (ms) of each audio file in order
 */
export function fillFilePositions(
  points: SyncPoint[],
  fileDurationsMs: number[],
): SyncPoint[] {
  return points.map((pt) => {
    let cum = 0;
    for (let i = 0; i < fileDurationsMs.length; i++) {
      const d = fileDurationsMs[i] ?? 0;
      if (cum + d > pt.audioMs) {
        return { ...pt, fileIndex: i, fileSeconds: (pt.audioMs - cum) / 1000 };
      }
      cum += d;
    }
    // Clamp to last file
    const last = fileDurationsMs.length - 1;
    return { ...pt, fileIndex: Math.max(0, last), fileSeconds: (fileDurationsMs[last] ?? 0) / 1000 };
  });
}

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/**
 * Return the SyncPoint whose audioMs is ≤ the given time (binary search).
 * Returns null if points is empty.
 */
export function lookupByAudio(points: SyncPoint[], audioMs: number): SyncPoint | null {
  if (!points.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].audioMs <= audioMs) lo = mid;
    else hi = mid - 1;
  }
  return points[lo];
}

/**
 * Return the first SyncPoint whose chapterIndex >= the given index.
 * Useful for ebook→audio sync.
 */
export function lookupByChapter(points: SyncPoint[], chapterIndex: number): SyncPoint | null {
  return points.find((p) => p.chapterIndex >= chapterIndex) ?? points[points.length - 1] ?? null;
}

/**
 * Find the chapter index that best matches a short transcribed audio window.
 *
 * Scoring: recall = fraction of unique window words found anywhere in the
 * chapter text.  Returns null if no chapter scores ≥ 0.25.
 *
 * @param windowText   Transcribed text from a 10–15 second audio window
 * @param chapters     Chapter texts as stored by chapterTextStorage
 */
export function findChapterByWindowText(
  windowText: string,
  chapters: { chapterIndex: number; text: string }[],
): number | null {
  const tokenize = (t: string): string[] => t.toLowerCase().match(/\b[a-z']{2,}\b/g) ?? [];

  const windowTokens = tokenize(windowText);
  if (!windowTokens.length || !chapters.length) return null;

  const windowSet = new Set(windowTokens);
  let bestChapter: number | null = null;
  let bestScore = 0;

  for (const ch of chapters) {
    const lower = ch.text.toLowerCase();
    let hits = 0;
    for (const w of windowSet) {
      if (lower.includes(w)) hits++;
    }
    const score = hits / windowSet.size;
    if (score > bestScore) {
      bestScore = score;
      bestChapter = ch.chapterIndex;
    }
  }

  return bestScore >= 0.25 ? bestChapter : null;
}

