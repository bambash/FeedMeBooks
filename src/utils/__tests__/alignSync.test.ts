import {
  buildSyncPoints,
  buildSyncPointsFromTranscripts,
  fillFilePositions,
  lookupByAudio,
  lookupByChapter,
  type ChapterText,
} from '../alignSync';
import type { PositionAnchor } from '../../types';
import type { TranscribeSegment } from '../transcribeAudio';

// ─── helpers ────────────────────────────────────────────────────────────────

function seg(t0Ms: number, t1Ms: number, text: string): TranscribeSegment {
  return { t0Ms, t1Ms, text };
}

function pt(audioMs: number, chapterIndex: number): PositionAnchor {
  return { audioMs, fileIndex: 0, fileSeconds: 0, chapterIndex, withinChapterFraction: 0, source: 'proportional' };
}

// ─── buildSyncPoints ─────────────────────────────────────────────────────────

describe('buildSyncPoints', () => {
  it('returns empty array when chapters are empty', () => {
    const segments: TranscribeSegment[] = [seg(0, 500, 'hello')];
    expect(buildSyncPoints(segments, [], 60_000)).toEqual([]);
  });

  it('returns empty array when all chapters have empty text', () => {
    const chapters: ChapterText[] = [
      { chapterIndex: 0, text: '' },
      { chapterIndex: 1, text: '   ' },
    ];
    expect(buildSyncPoints([], chapters, 60_000)).toEqual([]);
  });

  it('skips chapters with text shorter than 500 chars', () => {
    const chapters: ChapterText[] = [
      { chapterIndex: 0, text: '' },               // empty — skipped
      { chapterIndex: 1, text: 'short header' },    // < 500 chars — skipped (part headers etc.)
      { chapterIndex: 2, text: 'a'.repeat(500) },   // exactly 500 — kept
    ];
    const points = buildSyncPoints([], chapters, 60_000);
    expect(points).toHaveLength(1);
    expect(points[0].chapterIndex).toBe(2);
  });

  it('maps a single chapter to audioMs=0', () => {
    const chapters: ChapterText[] = [{ chapterIndex: 0, text: 'a'.repeat(500) }];
    const points = buildSyncPoints([], chapters, 60_000);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ audioMs: 0, chapterIndex: 0, fileIndex: 0 });
  });

  it('divides audio time proportionally by chapter text length', () => {
    // ch0 = 1000 chars, ch1 = 3000 chars → ch0 gets first 25%, ch1 gets remaining 75%
    const chapters: ChapterText[] = [
      { chapterIndex: 0, text: 'a'.repeat(1000) },
      { chapterIndex: 1, text: 'b'.repeat(3000) },
    ];
    const points = buildSyncPoints([], chapters, 100_000);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ audioMs: 0, chapterIndex: 0 });
    expect(points[1]).toMatchObject({ audioMs: 25_000, chapterIndex: 1 });
  });

  it('produces one point per substantive chapter in ascending audioMs order', () => {
    const chapters: ChapterText[] = [
      { chapterIndex: 0, text: 'a'.repeat(1000) },
      { chapterIndex: 1, text: '' },              // empty — skipped
      { chapterIndex: 2, text: 'b'.repeat(2000) },
      { chapterIndex: 3, text: 'c'.repeat(1000) },
    ];
    const points = buildSyncPoints([], chapters, 120_000);
    expect(points).toHaveLength(3);
    const indices = points.map((p) => p.chapterIndex);
    expect(indices).toEqual([0, 2, 3]);
    // Ascending audioMs
    for (let i = 1; i < points.length; i++) {
      expect(points[i].audioMs).toBeGreaterThan(points[i - 1].audioMs);
    }
  });

  it('falls back to segment-derived duration when totalMs is 0', () => {
    const chapters: ChapterText[] = [
      { chapterIndex: 0, text: 'a'.repeat(1000) },
      { chapterIndex: 1, text: 'b'.repeat(1000) },
    ];
    // Last segment ends at 80_000 ms → that becomes effectiveTotalMs
    const segments: TranscribeSegment[] = [seg(0, 40_000, 'x'), seg(40_000, 80_000, 'y')];
    const points = buildSyncPoints(segments, chapters, 0);
    expect(points).toHaveLength(2);
    expect(points[0].audioMs).toBe(0);
    expect(points[1].audioMs).toBe(40_000); // 50% of 80_000
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
  const points: PositionAnchor[] = [
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
  const points: PositionAnchor[] = [pt(0, 0), pt(30_000, 2), pt(60_000, 4)];

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

// ─── buildSyncPointsFromTranscripts ─────────────────────────────────────────

describe('buildSyncPointsFromTranscripts', () => {
  // Build chapter texts with unique vocabulary so matching is unambiguous
  const chapters: ChapterText[] = [
    { chapterIndex: 5, text: ('kaladin stormblessed bridge four lopen rock syl ').repeat(100) },
    { chapterIndex: 10, text: ('shallan davar jasnah kholin pattern cryptic lightweaving ').repeat(100) },
    { chapterIndex: 15, text: ('dalinar kholin adolin renarin highprince codes urithiru ').repeat(100) },
  ];
  const durs = [60_000, 60_000, 60_000];

  it('assigns each file to the chapter whose vocabulary best matches', () => {
    const transcripts = [
      'kaladin lopen rock ran across the bridge four times today',
      'shallan drew jasnah pattern cryptic lightweaving the boat',
      'dalinar adolin renarin highprince codes the tower urithiru',
    ];
    const pts = buildSyncPointsFromTranscripts(transcripts, durs, chapters);
    expect(pts).toHaveLength(3);
    expect(pts[0].chapterIndex).toBe(5);
    expect(pts[1].chapterIndex).toBe(10);
    expect(pts[2].chapterIndex).toBe(15);
  });

  it('sets audioMs to cumulative file start time', () => {
    const transcripts = ['kaladin bridge lopen rock syl', '', ''];
    const pts = buildSyncPointsFromTranscripts(transcripts, durs, chapters);
    expect(pts[0].audioMs).toBe(0);
    expect(pts[1].audioMs).toBe(60_000);
    expect(pts[2].audioMs).toBe(120_000);
  });

  it('holds chapter assignment for empty/silent files', () => {
    // file 0 matches ch5, file 1 is empty → should keep ch5
    const transcripts = ['kaladin bridge lopen rock syl stormblessed', '', ''];
    const pts = buildSyncPointsFromTranscripts(transcripts, durs, chapters);
    expect(pts[1].chapterIndex).toBe(5);
  });

  it('enforces monotonic chapter ordering', () => {
    // file 1 transcript matches ch5 (an earlier chapter) — should stay at ch10
    const transcripts = [
      'shallan jasnah pattern cryptic lightweaving',  // → ch10
      'kaladin bridge lopen rock syl',                // words from ch5, but ch5 < ch10 → skip
      'dalinar adolin renarin urithiru codes',        // → ch15
    ];
    const pts = buildSyncPointsFromTranscripts(transcripts, durs, chapters);
    expect(pts[0].chapterIndex).toBe(10);
    expect(pts[1].chapterIndex).toBe(10); // held, not regressed to ch5
    expect(pts[2].chapterIndex).toBe(15);
  });

  it('returns empty array when chapters is empty', () => {
    expect(buildSyncPointsFromTranscripts(['hello world'], [60_000], [])).toEqual([]);
  });
});
