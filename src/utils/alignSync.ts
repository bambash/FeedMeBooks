/**
 * Chapter alignment and position conversion.
 */

import type { AudiobookPositionMap, ChapterAnchor, ChapterPosition } from '../types';

export interface ChapterText {
  chapterIndex: number;
  /** Full plain text of the chapter (whitespace-normalized) */
  text: string;
  /** TOC label (chapter title) - used for logging and back-matter detection */
  label?: string;
}

export const BOUNDARY_PROBE_WORDS = 12;
export const SEARCH_WINDOW_FRACTION = 0.15;
export const SEARCH_WINDOW_MIN_MS = 90_000;
export const MATCH_THRESHOLD = 0.6;
export const CONTENT_CHAPTER_MIN_CHARS = 500;
export const CANONICAL_EPSILON = 1e-9;

const tokenizeWords = (text: string): string[] => text.toLowerCase().match(/\b[a-z']{2,}\b/g) ?? [];

const canonicalKey = (anchor: Pick<ChapterAnchor, 'chapterIndex' | 'withinChapterFraction'>): number =>
  anchor.chapterIndex + anchor.withinChapterFraction;

export function buildChapterAnchors(
  transcriptWords: { audioMs: number; text: string }[],
  chapters: ChapterText[],
  totalAudioMs: number,
): ChapterAnchor[] {
  if (!totalAudioMs || !chapters.length) return [];

  const contentChapters = chapters.filter((chapter) => chapter.text.trim().length >= CONTENT_CHAPTER_MIN_CHARS);
  if (!contentChapters.length) return [];

  const totalChars = contentChapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
  if (!totalChars) return [];

  const transcriptTokens = transcriptWords.map((word) => tokenizeWords(word.text)[0] ?? '');
  const anchors: ChapterAnchor[] = [];
  let cumCharsBefore = 0;

  for (const chapter of contentChapters) {
    const probeWords = tokenizeWords(chapter.text).slice(0, BOUNDARY_PROBE_WORDS);
    const probeSet = new Set(probeWords);
    const expectedMs = (cumCharsBefore / totalChars) * totalAudioMs;
    const searchWindowMs = Math.max(SEARCH_WINDOW_FRACTION * totalAudioMs, SEARCH_WINDOW_MIN_MS);
    const windowStart = anchors.length === 0 ? 0 : Math.max(0, expectedMs - searchWindowMs);
    const windowEnd = expectedMs + searchWindowMs;

    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < transcriptWords.length; i++) {
      const audioMs = transcriptWords[i]?.audioMs ?? 0;
      if (audioMs < windowStart || audioMs > windowEnd) continue;

      const candidateWords = transcriptTokens.slice(i, i + BOUNDARY_PROBE_WORDS).filter(Boolean);
      const candidateSet = new Set(candidateWords);
      let hits = 0;
      for (const token of probeSet) {
        if (candidateSet.has(token)) hits++;
      }

      const score = hits / BOUNDARY_PROBE_WORDS;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    let source: ChapterAnchor['source'] = 'proportional-fallback';
    let confidence: number | undefined;
    let resolvedMs = expectedMs;

    if (bestIndex >= 0 && bestScore >= MATCH_THRESHOLD) {
      resolvedMs = transcriptWords[bestIndex].audioMs;
      source = 'forced-alignment';
      confidence = bestScore;
    }

    const previous = anchors[anchors.length - 1];
    if (previous && resolvedMs <= previous.audioMs) {
      resolvedMs = Math.max(expectedMs, previous.audioMs + 1);
      source = 'proportional-fallback';
      confidence = undefined;
    }

    const anchor: ChapterAnchor = {
      chapterIndex: chapter.chapterIndex,
      withinChapterFraction: 0,
      audioMs: resolvedMs,
      source,
    };
    if (confidence != null) anchor.confidence = confidence;
    anchors.push(anchor);
    cumCharsBefore += chapter.text.length;
  }

  return anchors;
}

export function deriveBuiltFrom(anchors: ChapterAnchor[]): AudiobookPositionMap['builtFrom'] {
  return anchors.some((anchor) => anchor.source === 'forced-alignment') ? 'transcript' : 'unavailable';
}

export function chapterPositionToAudioMs(anchors: ChapterAnchor[], pos: ChapterPosition): number {
  if (!anchors.length) return 0;
  if (anchors.length === 1) return anchors[0].audioMs;

  const targetKey = canonicalKey(pos);
  const firstKey = canonicalKey(anchors[0]);
  const lastIndex = anchors.length - 1;
  const lastKey = canonicalKey(anchors[lastIndex]);

  if (targetKey <= firstKey) return anchors[0].audioMs;
  if (targetKey >= lastKey) return anchors[lastIndex].audioMs;

  let lo = 0;
  let hi = lastIndex;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (canonicalKey(anchors[mid]) <= targetKey) lo = mid;
    else hi = mid - 1;
  }

  const left = anchors[lo];
  const right = anchors[lo + 1];
  const leftKey = canonicalKey(left);
  const rightKey = canonicalKey(right);
  const keySpan = rightKey - leftKey;
  const audioSpan = right.audioMs - left.audioMs;

  if (Math.abs(keySpan) <= CANONICAL_EPSILON || Math.abs(audioSpan) <= CANONICAL_EPSILON) return left.audioMs;

  const t = (targetKey - leftKey) / keySpan;
  return left.audioMs + t * audioSpan;
}

export function audioMsToChapterPosition(anchors: ChapterAnchor[], audioMs: number): ChapterPosition {
  if (!anchors.length) return { chapterIndex: 0, withinChapterFraction: 0 };
  if (anchors.length === 1) return { chapterIndex: anchors[0].chapterIndex, withinChapterFraction: 0 };

  const first = anchors[0];
  const lastIndex = anchors.length - 1;
  const last = anchors[lastIndex];

  if (audioMs <= first.audioMs) {
    return { chapterIndex: first.chapterIndex, withinChapterFraction: 0 };
  }
  if (audioMs >= last.audioMs) {
    return { chapterIndex: last.chapterIndex, withinChapterFraction: 1 };
  }

  let lo = 0;
  let hi = lastIndex;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].audioMs < audioMs) lo = mid + 1;
    else hi = mid;
  }

  const rightIndex = lo;
  const right = anchors[rightIndex];
  if (Math.abs(right.audioMs - audioMs) <= CANONICAL_EPSILON) {
    return { chapterIndex: right.chapterIndex, withinChapterFraction: 0 };
  }

  const left = anchors[rightIndex - 1];
  if (Math.abs(right.audioMs - left.audioMs) <= CANONICAL_EPSILON) {
    return { chapterIndex: left.chapterIndex, withinChapterFraction: 0 };
  }

  const t = (audioMs - left.audioMs) / (right.audioMs - left.audioMs);
  const canonical = canonicalKey(left) + t * (canonicalKey(right) - canonicalKey(left));
  const chapterIndex = Math.floor(canonical);
  return { chapterIndex, withinChapterFraction: canonical - chapterIndex };
}

export function msToFilePosition(
  audioMs: number,
  fileDurationsMs: number[],
): { fileIndex: number; fileSeconds: number } {
  if (!fileDurationsMs.length || audioMs <= 0) {
    return { fileIndex: 0, fileSeconds: 0 };
  }

  const totalAudioMs = fileDurationsMs.reduce((sum, duration) => sum + (duration ?? 0), 0);
  if (audioMs >= totalAudioMs) {
    const lastIndex = Math.max(0, fileDurationsMs.length - 1);
    return { fileIndex: lastIndex, fileSeconds: (fileDurationsMs[lastIndex] ?? 0) / 1000 };
  }

  let cumulativeMs = 0;
  for (let i = 0; i < fileDurationsMs.length; i++) {
    const durationMs = fileDurationsMs[i] ?? 0;
    if (cumulativeMs + durationMs > audioMs) {
      return { fileIndex: i, fileSeconds: (audioMs - cumulativeMs) / 1000 };
    }
    cumulativeMs += durationMs;
  }

  const lastIndex = Math.max(0, fileDurationsMs.length - 1);
  return { fileIndex: lastIndex, fileSeconds: (fileDurationsMs[lastIndex] ?? 0) / 1000 };
}

export function percentageToAudioMs(pct: number, totalAudioMs: number): number {
  if (!totalAudioMs || pct <= 0) return 0;
  if (pct >= 1) return totalAudioMs;
  return pct * totalAudioMs;
}

export function audioMsToPercentage(audioMs: number, totalAudioMs: number): number {
  if (!totalAudioMs || audioMs <= 0) return 0;
  if (audioMs >= totalAudioMs) return 1;
  return audioMs / totalAudioMs;
}

export function refineChapterAnchor(
  anchors: ChapterAnchor[],
  confirmed: { chapterIndex: number; withinChapterFraction: number; audioMs: number },
  totalAudioMs: number,
): ChapterAnchor[] {
  const confirmedKey = confirmed.chapterIndex + confirmed.withinChapterFraction;

  const collisionIndex = anchors.findIndex((anchor) => Math.abs(canonicalKey(anchor) - confirmedKey) <= CANONICAL_EPSILON);
  const superseded = new Set<number>();

  if (collisionIndex >= 0) {
    superseded.add(collisionIndex);
  } else if (confirmed.withinChapterFraction > CANONICAL_EPSILON) {
    const interiorIndex = anchors.findIndex(
      (anchor) =>
        anchor.source === 'confirmed' &&
        anchor.chapterIndex === confirmed.chapterIndex &&
        Math.floor(canonicalKey(anchor)) === confirmed.chapterIndex &&
        Math.abs(anchor.withinChapterFraction - confirmed.withinChapterFraction) > CANONICAL_EPSILON,
    );
    if (interiorIndex >= 0) superseded.add(interiorIndex);
  }

  const surviving = anchors.filter((_, index) => !superseded.has(index));
  const survivingConfirmed = surviving.filter((anchor) => anchor.source === 'confirmed');

  const lowerConfirmed = survivingConfirmed
    .filter((anchor) => canonicalKey(anchor) < confirmedKey - CANONICAL_EPSILON)
    .sort((a, b) => canonicalKey(b) - canonicalKey(a))[0];
  const upperConfirmed = survivingConfirmed
    .filter((anchor) => canonicalKey(anchor) > confirmedKey + CANONICAL_EPSILON)
    .sort((a, b) => canonicalKey(a) - canonicalKey(b))[0];

  const lowMs = lowerConfirmed?.audioMs ?? 0;
  const highMs = upperConfirmed?.audioMs ?? totalAudioMs;
  const hasLowerReal = lowerConfirmed != null;
  const hasUpperReal = upperConfirmed != null;

  if ((hasLowerReal ? confirmed.audioMs <= lowMs : confirmed.audioMs < 0) ||
      (hasUpperReal ? confirmed.audioMs >= highMs : confirmed.audioMs > totalAudioMs)) {
    return anchors;
  }

  const next: ChapterAnchor[] = surviving.map((anchor) => ({ ...anchor }));
  const collidedAnchor = collisionIndex >= 0 ? anchors[collisionIndex] : null;
  const confirmedAnchor: ChapterAnchor = collidedAnchor
    ? {
        chapterIndex: collidedAnchor.chapterIndex,
        withinChapterFraction: collidedAnchor.withinChapterFraction,
        audioMs: confirmed.audioMs,
        source: 'confirmed',
      }
    : {
        chapterIndex: confirmed.chapterIndex,
        withinChapterFraction: confirmed.withinChapterFraction,
        audioMs: confirmed.audioMs,
        source: 'confirmed',
      };

  const insertAt = next.findIndex((anchor) => canonicalKey(anchor) > confirmedKey);
  if (insertAt === -1) next.push(confirmedAnchor);
  else next.splice(insertAt, 0, confirmedAnchor);

  let newIndex = next.findIndex((anchor) => Math.abs(canonicalKey(anchor) - confirmedKey) <= CANONICAL_EPSILON);

  for (let i = newIndex - 1; i >= 0; i--) {
    const neighborMs = next[i + 1].audioMs;
    const current = next[i];
    if (current.audioMs < neighborMs) continue;

    const clamped = neighborMs - 1;
    if (clamped <= lowMs) {
      next.splice(i, 1);
      newIndex--;
      continue;
    }

    current.audioMs = clamped;
    current.source = 'proportional-fallback';
    delete current.confidence;
  }

  for (let i = newIndex + 1; i < next.length; i++) {
    const neighborMs = next[i - 1].audioMs;
    const current = next[i];
    if (current.audioMs > neighborMs) continue;

    const clamped = neighborMs + 1;
    if (clamped >= highMs) {
      next.splice(i, 1);
      i--;
      continue;
    }

    current.audioMs = clamped;
    current.source = 'proportional-fallback';
    delete current.confidence;
  }

  return next.sort((a, b) => {
    const keyDelta = canonicalKey(a) - canonicalKey(b);
    if (Math.abs(keyDelta) > CANONICAL_EPSILON) return keyDelta;
    return a.audioMs - b.audioMs;
  });
}
