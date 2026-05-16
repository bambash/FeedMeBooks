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

// ─── Anchor helpers ─────────────────────────────────────────────────────────────

function anc(audioMs: number, chapterIndex: number): Anchor {
  return { audioMs, chapterIndex };
}

function ch(index: number, text: string): { chapterIndex: number; text: string } {
  return { chapterIndex: index, text };
}

function ch500(index: number): { chapterIndex: number; text: string } {
  return ch(index, 'x'.repeat(500));
}

// ─── createInitialAnchors ──────────────────────────────────────────────────────

describe('createInitialAnchors', () => {
  it('returns empty array for empty chapters', () => {
    expect(createInitialAnchors([], 60_000)).toEqual([]);
  });

  it('returns empty array when totalAudioMs is 0', () => {
    const chapters = [{ chapterIndex: 0, text: 'a'.repeat(500) }];
    expect(createInitialAnchors(chapters, 0)).toEqual([]);
  });

  it('returns empty array when no chapter meets the 500-char threshold', () => {
    const chapters = [ch(0, ''), ch(1, 'short'), ch(2, '   ')];
    expect(createInitialAnchors(chapters, 60_000)).toEqual([]);
  });

  it('maps single chapter to audioMs 0', () => {
    const chapters = [ch500(0)];
    const result = createInitialAnchors(chapters, 60_000);
    expect(result).toHaveLength(1);
    expect(result[0].audioMs).toBe(0);
    expect(result[0].chapterIndex).toBe(0);
  });

  it('assigns equal audioMs slices across multiple chapters', () => {
    const chapters = [ch500(0), ch500(1), ch500(2)];
    const result = createInitialAnchors(chapters, 90_000);
    expect(result).toHaveLength(3);
    expect(result[0].audioMs).toBe(0);
    expect(result[1].audioMs).toBe(30_000);
    expect(result[2].audioMs).toBe(60_000);
    expect(result.map((a) => a.chapterIndex)).toEqual([0, 1, 2]);
  });

  it('produces strictly ascending audioMs', () => {
    const chapters = [ch500(0), ch500(5), ch500(10)];
    const result = createInitialAnchors(chapters, 100_000);
    expect(result).toHaveLength(3);
    expect(result[0].audioMs).toBeLessThan(result[1].audioMs);
    expect(result[1].audioMs).toBeLessThan(result[2].audioMs);
  });

  it('skips chapters below 500 chars while keeping equal allocation for the rest', () => {
    const chapters = [ch(0, 'hi'), ch500(1), ch(2, '   '), ch500(3)];
    const result = createInitialAnchors(chapters, 60_000);
    expect(result).toHaveLength(2);
    expect(result[0].chapterIndex).toBe(1);
    expect(result[0].audioMs).toBe(0);
    expect(result[1].chapterIndex).toBe(3);
    expect(result[1].audioMs).toBe(30_000);
  });

  it('uses chapterIndex from input, not ordinal position', () => {
    const chapters = [ch500(7), ch500(3)];
    const result = createInitialAnchors(chapters, 60_000);
    expect(result.map((a) => a.chapterIndex)).toEqual([7, 3]);
  });
});

// ─── addConfirmedAnchor ────────────────────────────────────────────────────────

describe('addConfirmedAnchor', () => {
  const empty: Anchor[] = [];
  const existing: Anchor[] = [anc(0, 0), anc(30_000, 2), anc(60_000, 4)];

  it('inserts into empty array', () => {
    const result = addConfirmedAnchor(empty, anc(10_000, 1));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ audioMs: 10_000, chapterIndex: 1 });
  });

  it('does not mutate the input array', () => {
    const copy = [...existing];
    addConfirmedAnchor(existing, anc(15_000, 1));
    expect(existing).toEqual(copy);
  });

  it('inserts maintaining sort order by audioMs — middle', () => {
    const result = addConfirmedAnchor(existing, anc(15_000, 1));
    expect(result).toHaveLength(4);
    expect(result.map((a) => a.audioMs)).toEqual([0, 15_000, 30_000, 60_000]);
  });

  it('inserts maintaining sort order — before first', () => {
    const result = addConfirmedAnchor(
      [anc(10_000, 1), anc(20_000, 2)],
      anc(5_000, 0),
    );
    expect(result.map((a) => a.audioMs)).toEqual([5_000, 10_000, 20_000]);
  });

  it('inserts maintaining sort order — after last', () => {
    const result = addConfirmedAnchor(existing, anc(90_000, 6));
    expect(result).toHaveLength(4);
    expect(result[3].audioMs).toBe(90_000);
  });

  it('replaces anchor at same audioMs', () => {
    const result = addConfirmedAnchor(existing, anc(30_000, 99));
    expect(result).toHaveLength(3);
    const replaced = result.find((a) => a.audioMs === 30_000)!;
    expect(replaced.chapterIndex).toBe(99);
  });

  it('deduplicates — inserting an anchor already present is a no-op', () => {
    const result = addConfirmedAnchor(existing, anc(30_000, 2));
    expect(result).toHaveLength(3);
    expect(result).toEqual(existing);
  });
});

// ─── interpolateCanonical ──────────────────────────────────────────────────────

describe('interpolateCanonical', () => {
  const anchors: Anchor[] = [anc(0, 0), anc(30_000, 2), anc(60_000, 4)];

  it('returns null for empty anchors', () => {
    expect(interpolateCanonical([], 10_000)).toBeNull();
  });

  it('exact match returns anchor values', () => {
    expect(interpolateCanonical(anchors, 30_000)).toEqual({
      chapterIndex: 2,
      fraction: 0,
    });
  });

  it('first anchor exact match (audioMs 0)', () => {
    expect(interpolateCanonical(anchors, 0)).toEqual({
      chapterIndex: 0,
      fraction: 0,
    });
  });

  it('linear interpolation between two anchors — midpoint', () => {
    // 45_000 ms is halfway between ch2 (30k) and ch4 (60k)
    // canonical = 2 + 0.5*2 = 3, so chapterIndex=3 fraction=0
    const result = interpolateCanonical(anchors, 45_000);
    expect(result).toEqual({ chapterIndex: 3, fraction: 0 });
  });

  it('linear interpolation — closer to left anchor', () => {
    // 40_000 ms is 1/3 between ch2 (30k) and ch4 (60k)
    // canonical = 2 + (1/3)*2 = 2.667, so chapterIndex=2 fraction≈0.667
    const result = interpolateCanonical(anchors, 40_000);
    expect(result!.chapterIndex).toBe(2);
    expect(result!.fraction).toBeCloseTo(2 / 3, 5);
  });

  it('before first anchor returns first anchor values', () => {
    const result = interpolateCanonical(anchors, -5_000);
    expect(result).toEqual({
      chapterIndex: 0,
      fraction: 0,
    });
  });

  it('past last anchor returns last anchor values', () => {
    const result = interpolateCanonical(anchors, 999_000);
    expect(result).toEqual({
      chapterIndex: 4,
      fraction: 0,
    });
  });

  it('single anchor always returns that anchor', () => {
    const single = [anc(50_000, 3)];
    expect(interpolateCanonical(single, 10_000)).toEqual({
      chapterIndex: 3,
      fraction: 0,
    });
    expect(interpolateCanonical(single, 80_000)).toEqual({
      chapterIndex: 3,
      fraction: 0,
    });
  });
});

// ─── interpolateAudioMs ────────────────────────────────────────────────────────

describe('interpolateAudioMs', () => {
  const anchors: Anchor[] = [anc(0, 0), anc(30_000, 2), anc(60_000, 4)];

  it('exact chapter match with fraction 0 returns anchor audioMs', () => {
    expect(interpolateAudioMs(anchors, 2, 0)).toBe(30_000);
    expect(interpolateAudioMs(anchors, 0, 0)).toBe(0);
  });

  it('fraction > 0 interpolates between this and next anchor', () => {
    // canonical = 2 + 0.5 = 2.5, t = (2.5-2)/(4-2) = 0.25
    // audioMs = 30000 + 0.25*30000 = 37500
    const result = interpolateAudioMs(anchors, 2, 0.5);
    expect(result).toBe(37_500);
  });

  it('fraction 0.25 interpolates correctly', () => {
    // canonical = 2 + 0.25 = 2.25, t = (2.25-2)/(4-2) = 0.125
    // audioMs = 30000 + 0.125*30000 = 33750
    const result = interpolateAudioMs(anchors, 2, 0.25);
    expect(result).toBe(33_750);
  });

  it('clamps to first anchor audioMs when canonical is before all anchors', () => {
    const singleAnchor = [anc(50_000, 5)];
    expect(interpolateAudioMs(singleAnchor, 3, 0)).toBe(50_000);
  });

  it('past last returns last anchor audioMs', () => {
    expect(interpolateAudioMs(anchors, 99, 0)).toBe(60_000);
  });

  it('fraction > 0 for last chapter clamps to last anchor', () => {
    expect(interpolateAudioMs(anchors, 4, 0.5)).toBe(60_000);
  });
});
