import {
  buildSyncPoints,
  buildSyncPointsFromTranscripts,
  fillFilePositions,
  lookupByAudio,
  lookupByChapter,
  createInitialAnchors,
  addConfirmedAnchor,
  interpolateCanonical,
  interpolateAudioMs,
  type ChapterText,
  type Anchor,
} from '../alignSync';
import type { SyncPoint } from '../../types';
import type { TranscribeSegment } from '../transcribeAudio';

// ─── helpers ────────────────────────────────────────────────────────────────

function seg(t0Ms: number, t1Ms: number, text: string): TranscribeSegment {
  return { t0Ms, t1Ms, text };
}

function pt(audioMs: number, chapterIndex: number): SyncPoint {
  return { audioMs, fileIndex: 0, fileSeconds: 0, chapterIndex, withinChapterFraction: 0 };
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

// ─── createInitialAnchors ────────────────────────────────────────────────────

describe('createInitialAnchors', () => {
  it('returns empty array when chapters is empty', () => {
    expect(createInitialAnchors([], 60_000)).toEqual([]);
  });

  it('returns empty array when totalAudioMs is 0', () => {
    const chapters: ChapterText[] = [{ chapterIndex: 0, text: 'a'.repeat(500) }];
    expect(createInitialAnchors(chapters, 0)).toEqual([]);
  });

  it('returns empty array when no chapter meets the 500-char threshold', () => {
    const chapters: ChapterText[] = [
      { chapterIndex: 0, text: '' },
      { chapterIndex: 1, text: 'short' },
    ];
    expect(createInitialAnchors(chapters, 60_000)).toEqual([]);
  });

  it('creates one anchor per content chapter with equal allocation', () => {
    const chapters: ChapterText[] = [
      { chapterIndex: 0, text: 'a'.repeat(500) },
      { chapterIndex: 1, text: 'b'.repeat(500) },
      { chapterIndex: 2, text: 'c'.repeat(500) },
    ];
    const anchors = createInitialAnchors(chapters, 90_000);
    expect(anchors).toHaveLength(3);
    expect(anchors[0]).toEqual({ audioMs: 0, chapterIndex: 0 });
    expect(anchors[1]).toEqual({ audioMs: 30_000, chapterIndex: 1 });
    expect(anchors[2]).toEqual({ audioMs: 60_000, chapterIndex: 2 });
  });

  it('skips chapters with text under 500 chars', () => {
    const chapters: ChapterText[] = [
      { chapterIndex: 0, text: '' },
      { chapterIndex: 1, text: 'a'.repeat(500) },
      { chapterIndex: 2, text: 'short header' },
      { chapterIndex: 3, text: 'b'.repeat(500) },
    ];
    const anchors = createInitialAnchors(chapters, 100_000);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].chapterIndex).toBe(1);
    expect(anchors[1].chapterIndex).toBe(3);
  });
});

// ─── addConfirmedAnchor ──────────────────────────────────────────────────────

describe('addConfirmedAnchor', () => {
  let anchors: Anchor[];

  beforeEach(() => {
    anchors = [
      { audioMs: 0, chapterIndex: 0 },
      { audioMs: 30_000, chapterIndex: 2 },
      { audioMs: 60_000, chapterIndex: 4 },
    ];
  });

  it('inserts a new anchor in sorted position', () => {
    const result = addConfirmedAnchor(anchors, { audioMs: 45_000, chapterIndex: 3 });
    expect(result).toHaveLength(4);
    expect(result.map((a) => a.audioMs)).toEqual([0, 30_000, 45_000, 60_000]);
  });

  it('replaces an existing anchor at the same audioMs', () => {
    const result = addConfirmedAnchor(anchors, { audioMs: 30_000, chapterIndex: 99 });
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({ audioMs: 30_000, chapterIndex: 99 });
  });

  it('inserts at the beginning when audioMs is lowest', () => {
    const result = addConfirmedAnchor(anchors, { audioMs: 0, chapterIndex: 42 });
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ audioMs: 0, chapterIndex: 42 });
  });

  it('inserts at the end when audioMs is highest', () => {
    const result = addConfirmedAnchor(anchors, { audioMs: 90_000, chapterIndex: 6 });
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ audioMs: 90_000, chapterIndex: 6 });
  });

  it('handles empty anchor list', () => {
    const result = addConfirmedAnchor([], { audioMs: 10_000, chapterIndex: 0 });
    expect(result).toEqual([{ audioMs: 10_000, chapterIndex: 0 }]);
  });
});

// ─── interpolateCanonical ────────────────────────────────────────────────────

describe('interpolateCanonical', () => {
  const anchors: Anchor[] = [
    { audioMs: 0, chapterIndex: 0 },
    { audioMs: 30_000, chapterIndex: 3 },
    { audioMs: 100_000, chapterIndex: 7 },
  ];

  it('returns null for empty anchors', () => {
    expect(interpolateCanonical([], 5_000)).toBeNull();
  });

  it('returns the first anchor for audioMs before the first anchor', () => {
    // Single anchor at audioMs=0 — any query returns it
    const single = [{ audioMs: 10_000, chapterIndex: 1 }];
    expect(interpolateCanonical(single, 5_000)).toEqual({
      chapterIndex: 1,
      fraction: 0,
    });
  });

  it('returns exact match when audioMs lands on an anchor', () => {
    expect(interpolateCanonical(anchors, 0)).toEqual({
      chapterIndex: 0,
      fraction: 0,
    });
    expect(interpolateCanonical(anchors, 30_000)).toEqual({
      chapterIndex: 3,
      fraction: 0,
    });
  });

  it('interpolates between two anchors', () => {
    // audioMs=15_000 is halfway between ch0 (0) and ch3 (30_000)
    // canonical = 0 + 0.5 * 3 = 1.5 → ch1, fraction 0.5
    expect(interpolateCanonical(anchors, 15_000)).toEqual({
      chapterIndex: 1,
      fraction: 0.5,
    });
  });

  it('interpolates near the right edge', () => {
    // audioMs=65_000 is halfway between ch3 (30_000) and ch7 (100_000)
    // t = (65000-30000)/(100000-30000) = 35000/70000 = 0.5
    // canonical = 3 + 0.5 * 4 = 5 → ch5, fraction 0
    expect(interpolateCanonical(anchors, 65_000)).toEqual({
      chapterIndex: 5,
      fraction: 0,
    });
  });

  it('returns last anchor for audioMs past all anchors', () => {
    expect(interpolateCanonical(anchors, 200_000)).toEqual({
      chapterIndex: 7,
      fraction: 0,
    });
  });

  it('handles single-anchor list', () => {
    const single = [{ audioMs: 5_000, chapterIndex: 2 }];
    expect(interpolateCanonical(single, 0)).toEqual({
      chapterIndex: 2,
      fraction: 0,
    });
    expect(interpolateCanonical(single, 10_000)).toEqual({
      chapterIndex: 2,
      fraction: 0,
    });
  });

  it('clamps t to [0,1] when audioMs is between same-value anchors', () => {
    const dup = [
      { audioMs: 0, chapterIndex: 0 },
      { audioMs: 0, chapterIndex: 0 },
    ];
    const result = interpolateCanonical(dup, 0);
    expect(result).not.toBeNull();
    expect(result!.chapterIndex).toBe(0);
    expect(result!.fraction).toBe(0);
  });
});

// ─── interpolateAudioMs ──────────────────────────────────────────────────────

describe('interpolateAudioMs', () => {
  const anchors: Anchor[] = [
    { audioMs: 0, chapterIndex: 0 },
    { audioMs: 30_000, chapterIndex: 3 },
    { audioMs: 100_000, chapterIndex: 7 },
  ];

  it('returns null for empty anchors', () => {
    expect(interpolateAudioMs([], 0, 0)).toBeNull();
  });

  it('returns the first anchor audioMs when canonical is before all anchors', () => {
    const shifted = [
      { audioMs: 10_000, chapterIndex: 1 },
      { audioMs: 50_000, chapterIndex: 3 },
    ];
    // canonical = 0.5 → before chapterIndex 1
    expect(interpolateAudioMs(shifted, 0, 0.5)).toBe(10_000);
  });

  it('returns exact audioMs when canonical lands on an anchor chapter', () => {
    expect(interpolateAudioMs(anchors, 0, 0)).toBe(0);
    expect(interpolateAudioMs(anchors, 3, 0)).toBe(30_000);
    expect(interpolateAudioMs(anchors, 7, 0)).toBe(100_000);
  });

  it('interpolates between two anchors', () => {
    // canonical = 1.5 is halfway between ch0 and ch3
    // t = (1.5 - 0) / (3 - 0) = 0.5
    // audioMs = 0 + 0.5 * 30000 = 15000
    expect(interpolateAudioMs(anchors, 1, 0.5)).toBe(15_000);
  });

  it('interpolates near the right edge', () => {
    // canonical = 5 is halfway between ch3 and ch7
    // t = (5 - 3) / (7 - 3) = 0.5
    // audioMs = 30000 + 0.5 * 70000 = 65000
    expect(interpolateAudioMs(anchors, 5, 0)).toBe(65_000);
  });

  it('returns last anchor audioMs when canonical is past all anchors', () => {
    expect(interpolateAudioMs(anchors, 99, 0)).toBe(100_000);
  });

  it('handles single-anchor list', () => {
    const single = [{ audioMs: 5_000, chapterIndex: 2 }];
    expect(interpolateAudioMs(single, 0, 0)).toBe(5_000);
    expect(interpolateAudioMs(single, 99, 0.9)).toBe(5_000);
  });

  it('returns anchor audioMs when chapter range is zero', () => {
    const same = [
      { audioMs: 0, chapterIndex: 5 },
      { audioMs: 50_000, chapterIndex: 5 },
    ];
    expect(interpolateAudioMs(same, 5, 0.3)).toBe(50_000);
  });
});
