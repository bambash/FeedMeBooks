import {
  buildSyncPoints,
  fillFilePositions,
  lookupByAudio,
  lookupByChapter,
  type ChapterText,
} from '../alignSync';
import type { SyncPoint } from '../../types';
import type { TranscribeSegment } from '../transcribeAudio';

// ─── helpers ────────────────────────────────────────────────────────────────

function seg(t0Ms: number, text: string): TranscribeSegment {
  return { t0Ms, t1Ms: t0Ms + 500, text };
}

function pt(audioMs: number, chapterIndex: number): SyncPoint {
  return { audioMs, fileIndex: 0, fileSeconds: 0, chapterIndex, withinChapterFraction: 0 };
}

// ─── buildSyncPoints ─────────────────────────────────────────────────────────

describe('buildSyncPoints', () => {
  it('returns empty array when segments or chapters are empty', () => {
    const chapters: ChapterText[] = [{ chapterIndex: 0, text: 'hello world' }];
    const segments: TranscribeSegment[] = [seg(0, 'hello')];
    expect(buildSyncPoints([], chapters, 60_000)).toEqual([]);
    expect(buildSyncPoints(segments, [], 60_000)).toEqual([]);
  });

  it('assigns a single chapter when all words match it', () => {
    const segments = [seg(0, 'alpha'), seg(500, 'beta'), seg(1000, 'gamma')];
    const chapters = [
      { chapterIndex: 0, text: 'alpha beta gamma delta' },
      { chapterIndex: 1, text: 'totally different content here' },
    ];
    const points = buildSyncPoints(segments, chapters, 60_000);
    expect(points.every(p => p.chapterIndex === 0)).toBe(true);
  });

  it('advances to a later chapter when transcript matches it better', () => {
    // First 30 s: words from ch0; from 30 s: words from ch1
    const segments = [
      seg(0, 'alpha'), seg(500, 'beta'), seg(1000, 'gamma'),
      seg(30_000, 'delta'), seg(30_500, 'epsilon'), seg(31_000, 'zeta'),
    ];
    const chapters = [
      { chapterIndex: 0, text: 'alpha beta gamma filler' },
      { chapterIndex: 1, text: 'delta epsilon zeta filler' },
    ];
    const points = buildSyncPoints(segments, chapters, 60_000);
    const indices = points.map(p => p.chapterIndex);
    expect(indices).toContain(0);
    expect(indices).toContain(1);
    // chapter index must never go backwards
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it('never decreases chapter index (monotonicity)', () => {
    const segments = Array.from({ length: 12 }, (_, i) =>
      seg(i * 5_000, `word${i % 4}`),
    );
    const chapters = [
      { chapterIndex: 0, text: 'word0 word1 filler' },
      { chapterIndex: 1, text: 'word2 word3 filler' },
    ];
    const points = buildSyncPoints(segments, chapters, 120_000);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].chapterIndex).toBeGreaterThanOrEqual(points[i - 1].chapterIndex);
    }
  });
});

// ─── fillFilePositions ───────────────────────────────────────────────────────

describe('fillFilePositions', () => {
  it('puts points within the first file when durations cover them', () => {
    const points = [pt(0, 0), pt(30_000, 1)];
    const filled = fillFilePositions(points, [60_000]);
    expect(filled[0]).toMatchObject({ fileIndex: 0, fileSeconds: 0 });
    expect(filled[1]).toMatchObject({ fileIndex: 0, fileSeconds: 30 });
  });

  it('rolls over to the second file correctly', () => {
    const points = [pt(0, 0), pt(50_000, 1), pt(90_000, 2)];
    // File 0 = 60 s, File 1 = 60 s
    const filled = fillFilePositions(points, [60_000, 60_000]);
    expect(filled[0]).toMatchObject({ fileIndex: 0, fileSeconds: 0 });
    expect(filled[1]).toMatchObject({ fileIndex: 0, fileSeconds: 50 });
    expect(filled[2]).toMatchObject({ fileIndex: 1, fileSeconds: 30 });
  });

  it('clamps past-end point to last file', () => {
    const points = [pt(999_000, 5)];
    const filled = fillFilePositions(points, [60_000]);
    expect(filled[0].fileIndex).toBe(0);
  });
});

// ─── lookupByAudio ───────────────────────────────────────────────────────────

describe('lookupByAudio', () => {
  const points: SyncPoint[] = [
    pt(0, 0),
    pt(30_000, 1),
    pt(60_000, 2),
  ];

  it('returns null for empty array', () => {
    expect(lookupByAudio([], 5_000)).toBeNull();
  });

  it('returns the first point for t=0', () => {
    expect(lookupByAudio(points, 0)).toBe(points[0]);
  });

  it('returns exact match', () => {
    expect(lookupByAudio(points, 30_000)).toBe(points[1]);
  });

  it('returns floor point (largest audioMs ≤ query)', () => {
    expect(lookupByAudio(points, 45_000)).toBe(points[1]);
    expect(lookupByAudio(points, 29_999)).toBe(points[0]);
  });

  it('returns last point for time past all points', () => {
    expect(lookupByAudio(points, 999_000)).toBe(points[2]);
  });
});

// ─── lookupByChapter ─────────────────────────────────────────────────────────

describe('lookupByChapter', () => {
  const points: SyncPoint[] = [pt(0, 0), pt(30_000, 2), pt(60_000, 4)];

  it('returns null for empty array', () => {
    expect(lookupByChapter([], 1)).toBeNull();
  });

  it('finds an exact chapter match', () => {
    expect(lookupByChapter(points, 2)).toBe(points[1]);
  });

  it('finds the first point whose chapter >= target', () => {
    expect(lookupByChapter(points, 1)).toBe(points[1]); // ch2 ≥ 1
    expect(lookupByChapter(points, 3)).toBe(points[2]); // ch4 ≥ 3
  });

  it('returns last point when chapter exceeds all', () => {
    expect(lookupByChapter(points, 99)).toBe(points[2]);
  });
});
