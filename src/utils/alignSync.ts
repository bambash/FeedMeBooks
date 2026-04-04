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
 * dividing the timeline proportionally by chapter text length.
 *
 * @param segments  Word-level segments (used only to derive totalMs if caller
 *                  passes 0; otherwise unused in the proportional algorithm)
 * @param chapters  Epub chapter texts (chapterIndex = spine index, 0-based)
 * @param totalMs   Total audiobook duration in ms
 */
export function buildSyncPoints(
  segments: TranscribeSegment[],
  chapters: ChapterText[],
  totalMs: number,
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

  const totalChars = contentChapters.reduce((sum, c) => sum + c.text.length, 0);
  if (!totalChars) return [];

  const points: SyncPoint[] = [];
  let cumChars = 0;

  for (const chapter of contentChapters) {
    const audioMs = Math.round((cumChars / totalChars) * effectiveTotalMs);
    points.push({
      audioMs,
      fileIndex: 0,          // filled in by fillFilePositions()
      fileSeconds: 0,
      chapterIndex: chapter.chapterIndex,
      withinChapterFraction: 0,
    });
    cumChars += chapter.text.length;
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
 *  - For each audio file, compute recall = |transcript ∩ chapter| / |transcript|
 *    for every chapter at or after the last matched chapter (monotonic)
 *  - Assign the highest-scoring chapter to that file
 *  - If no chapter exceeds the 0.25 recall threshold, keep the last assignment
 *
 * Returns one SyncPoint per audio file (at the file's start position).
 * fileIndex and fileSeconds are already populated — fillFilePositions is not needed.
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

  const points: SyncPoint[] = [];
  let cumulativeMs = 0;
  let lastChapterIdx = contentChapters[0]?.chapterIndex ?? 0;

  for (let fileIdx = 0; fileIdx < fileTranscripts.length; fileIdx++) {
    const transcript = fileTranscripts[fileIdx];
    const durationMs = fileDurationsMs[fileIdx] ?? 0;

    if (transcript.trim().length > 0) {
      const transcriptWords = new Set(tokenizeWords(transcript));

      if (transcriptWords.size > 0) {
        let bestChapterIdx = lastChapterIdx;
        let bestScore = -1;

        // Only search chapters at/after the last match to enforce monotonic ordering
        const startSearchAt = contentChapters.findIndex((c) => c.chapterIndex >= lastChapterIdx);
        const searchFrom = startSearchAt >= 0 ? startSearchAt : 0;

        for (let ci = searchFrom; ci < contentChapters.length; ci++) {
          const chWords = chapterWordSets[ci];
          let hits = 0;
          for (const w of transcriptWords) {
            if (chWords.has(w)) hits++;
          }
          const score = hits / transcriptWords.size;
          if (score > bestScore) {
            bestScore = score;
            bestChapterIdx = contentChapters[ci].chapterIndex;
          }
        }

        if (bestScore >= 0.25) {
          lastChapterIdx = bestChapterIdx;
        }
      }
    }

    points.push({
      audioMs: cumulativeMs,
      fileIndex: fileIdx,
      fileSeconds: 0, // each point is the start of the file
      chapterIndex: lastChapterIdx,
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

