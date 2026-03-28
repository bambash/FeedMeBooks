/**
 * Audio↔ebook alignment.
 *
 * Takes word-level Whisper transcript segments and epub chapter texts,
 * produces a SyncMap: a sorted list of (audioMs → chapterIndex) points.
 *
 * Algorithm: sliding 30-second windows over the full transcript.
 * For each window we compute Jaccard text similarity against the current
 * chapter and up to LOOKAHEAD chapters ahead, advancing the chapter pointer
 * when a better match is found (monotone — chapter order is preserved).
 */

import type { SyncPoint } from '../types';
import type { TranscribeSegment } from './transcribeAudio';

// ─── Alignment config ────────────────────────────────────────────────────────

const WINDOW_MS = 30_000; // comparison window width (ms)
const STEP_MS   = 10_000; // how far to advance per iteration (ms)
const LOOKAHEAD = 3;      // max chapters to search ahead at each step

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChapterText {
  chapterIndex: number;
  /** Full plain text of the chapter (whitespace-normalised) */
  text: string;
}

// ─── Text helpers ────────────────────────────────────────────────────────────

/** Tokenise text into lowercase alphanumeric words */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Jaccard similarity (|A∩B| / |A∪B|) between two word arrays.
 * Uses Set semantics so duplicate words don't inflate the score.
 */
function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─── Core alignment ──────────────────────────────────────────────────────────

/**
 * Build a list of sync points from transcript segments and chapter texts.
 *
 * @param segments   Word-level segments; t0Ms is offset from audiobook start (ms)
 * @param chapters   Epub chapter texts (chapterIndex = spine index, 0-based)
 * @param totalMs    Total audiobook duration in ms
 * @returns          Sync points, sorted ascending by audioMs, fileIndex/fileSeconds = 0
 *                   (call fillFilePositions() afterwards to populate those fields)
 */
export function buildSyncPoints(
  segments: TranscribeSegment[],
  chapters: ChapterText[],
  totalMs: number,
): SyncPoint[] {
  if (!segments.length || !chapters.length) return [];

  // Pre-tokenise all chapters once — expensive but done only at index time
  const chapterTokens = chapters.map((c) => tokenize(c.text));

  const points: SyncPoint[] = [];
  let currentChapterIdx = 0;

  for (let windowStart = 0; windowStart < totalMs; windowStart += STEP_MS) {
    const windowEnd = windowStart + WINDOW_MS;

    // Words in this time window
    const windowWords = segments
      .filter((s) => s.t0Ms >= windowStart && s.t0Ms < windowEnd)
      .map((s) => s.text)
      .join(' ');
    const windowTokens = tokenize(windowWords);

    if (!windowTokens.length) continue;

    // Find best-scoring chapter, capped at LOOKAHEAD ahead
    let bestScore = 0;
    let bestChapter = currentChapterIdx;
    const maxC = Math.min(currentChapterIdx + LOOKAHEAD, chapters.length - 1);

    for (let c = currentChapterIdx; c <= maxC; c++) {
      const score = jaccard(windowTokens, chapterTokens[c]);
      if (score > bestScore) {
        bestScore = score;
        bestChapter = c;
      }
    }

    if (bestChapter > currentChapterIdx) {
      currentChapterIdx = bestChapter;
    }

    // Emit a point only when the chapter changes (or at the very start)
    const last = points[points.length - 1];
    if (!last || last.chapterIndex !== currentChapterIdx) {
      points.push({
        audioMs: windowStart,
        fileIndex: 0,              // filled in by fillFilePositions()
        fileSeconds: 0,
        chapterIndex: currentChapterIdx,
        withinChapterFraction: 0,
      });
    }
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
