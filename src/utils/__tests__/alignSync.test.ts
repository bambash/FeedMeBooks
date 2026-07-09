import {
  buildChapterAnchors,
  chapterPositionToAudioMs,
  audioMsToChapterPosition,
  deriveBuiltFrom,
  msToFilePosition,
  percentageToAudioMs,
  audioMsToPercentage,
  refineChapterAnchor,
  type ChapterText,
} from '../alignSync';

function chapter(chapterIndex: number, text: string): ChapterText {
  return { chapterIndex, text };
}

function textOfLength(prefix: string, totalLength: number): string {
  const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit ';
  let text = prefix;
  while (text.length < totalLength) text += filler;
  return text.slice(0, totalLength);
}

function contentChapter(chapterIndex: number, opener: string, totalLength = 1200): ChapterText {
  return chapter(chapterIndex, textOfLength(`${opener} `, totalLength));
}

function wordStream(startMs: number, words: string[], stepMs = 1): { audioMs: number; text: string }[] {
  return words.map((text, index) => ({ audioMs: startMs + index * stepMs, text }));
}

function anchor(
  chapterIndex: number,
  withinChapterFraction: number,
  audioMs: number,
  source: 'forced-alignment' | 'proportional-fallback' | 'confirmed' = 'proportional-fallback',
  confidence?: number,
): ReturnType<typeof refineChapterAnchor>[number] {
  const result = { chapterIndex, withinChapterFraction, audioMs, source } as any;
  if (confidence != null) result.confidence = confidence;
  return result;
}

function canonicalKeyOf(a: { chapterIndex: number; withinChapterFraction: number }): number {
  return a.chapterIndex + a.withinChapterFraction;
}

function expectStrictAscending(anchors: { chapterIndex: number; withinChapterFraction: number; audioMs: number }[]): void {
  for (let i = 1; i < anchors.length; i++) {
    expect(anchors[i].audioMs).toBeGreaterThan(anchors[i - 1].audioMs);
    expect(canonicalKeyOf(anchors[i])).toBeGreaterThan(canonicalKeyOf(anchors[i - 1]));
  }
}

describe('buildChapterAnchors', () => {
  it('excludes non-content dividers', () => {
    const chapters = [
      contentChapter(5, 'alpha one two three four five six seven eight nine ten eleven twelve'),
      chapter(6, 'Part Two'),
      contentChapter(7, 'theta one two three four five six seven eight nine ten eleven twelve'),
    ];
    const transcriptWords = [
      ...wordStream(0, 'alpha one two three four five six seven eight nine ten eleven twelve'.split(' ')),
      ...wordStream(3_000_000, 'theta one two three four five six seven eight nine ten eleven twelve'.split(' ')),
    ];

    const anchors = buildChapterAnchors(transcriptWords, chapters, 6_000_000);
    expect(anchors.map((anchor) => anchor.chapterIndex)).toEqual([5, 7]);
  });

  it('returns an empty list when every chapter is below threshold', () => {
    const chapters = [chapter(0, 'short'), chapter(1, 'also short')];
    expect(buildChapterAnchors([], chapters, 60_000)).toEqual([]);
  });

  it('creates a forced-alignment anchor for a confident match', () => {
    const opener = 'alpha one two three four five six seven eight nine ten eleven twelve';
    const chapters = [contentChapter(12, opener, 1200)];
    const transcriptWords = wordStream(1_830_000, opener.split(' '));

    const anchors = buildChapterAnchors(transcriptWords, chapters, 20_000_000);
    expect(anchors).toEqual([
      {
        chapterIndex: 12,
        withinChapterFraction: 0,
        audioMs: 1_830_000,
        source: 'forced-alignment',
        confidence: 1,
      },
    ]);
    expect(deriveBuiltFrom(anchors)).toBe('transcript');
  });

  it('falls back proportionally when the best score is below threshold', () => {
    const opener = 'gamma one two three four five six seven eight nine ten eleven twelve';
    const chapters = [
      contentChapter(0, 'alpha one two three four five six seven eight nine ten eleven twelve'),
      contentChapter(1, opener),
    ];
    const transcriptWords = [
      ...wordStream(0, 'alpha one two three four five six seven eight nine ten eleven twelve'.split(' ')),
      ...wordStream(2_700_000, 'gamma one two three mismatch mismatch mismatch mismatch'.split(' ')),
    ];

    const anchors = buildChapterAnchors(transcriptWords, chapters, 6_000_000);
    expect(anchors[1]).toMatchObject({
      chapterIndex: 1,
      withinChapterFraction: 0,
      audioMs: 3_000_000,
      source: 'proportional-fallback',
    });
    expect(anchors[1].confidence).toBeUndefined();
  });

  it('searches a one-sided window for the first content chapter', () => {
    const opener = 'delta one two three four five six seven eight nine ten eleven twelve';
    const chapters = [contentChapter(3, opener)];
    const transcriptWords = [
      ...wordStream(0, 'publisher lead in no match at all'.split(' '), 5_000),
      ...wordStream(45_000, opener.split(' ')),
    ];

    const anchors = buildChapterAnchors(transcriptWords, chapters, 300_000);
    expect(anchors[0]).toMatchObject({
      chapterIndex: 3,
      withinChapterFraction: 0,
      audioMs: 45_000,
      source: 'forced-alignment',
    });
  });

  it('rejects backward matches and keeps the map strictly ascending', () => {
    const opener8 = 'theta one two three four five six seven eight nine ten eleven twelve';
    const opener9 = 'sigma one two three four five six seven eight nine ten eleven twelve';
    const chapters = [contentChapter(8, opener8, 1450), contentChapter(9, opener9, 8550)];
    const transcriptWords = [
      ...wordStream(3_000_000, opener8.split(' ')),
      ...wordStream(2_900_000, opener9.split(' ')),
    ];

    const anchors = buildChapterAnchors(transcriptWords, chapters, 20_000_000);
    expect(anchors).toEqual([
      {
        chapterIndex: 8,
        withinChapterFraction: 0,
        audioMs: 3_000_000,
        source: 'forced-alignment',
        confidence: 1,
      },
      {
        chapterIndex: 9,
        withinChapterFraction: 0,
        audioMs: 3_000_001,
        source: 'proportional-fallback',
      },
    ]);
  });

  it('reports builtFrom unavailable when every anchor falls back', () => {
    const chapters = [contentChapter(0, 'alpha one two three four five six seven eight nine ten eleven twelve')];
    const transcriptWords = wordStream(10_000, 'nothing matches here at all'.split(' '));

    const anchors = buildChapterAnchors(transcriptWords, chapters, 60_000);
    expect(anchors).toEqual([
      {
        chapterIndex: 0,
        withinChapterFraction: 0,
        audioMs: 0,
        source: 'proportional-fallback',
      },
    ]);
    expect(deriveBuiltFrom(anchors)).toBe('unavailable');
  });
});

describe('chapterPositionToAudioMs', () => {
  it('interpolates between adjacent canonical keys', () => {
    const anchors = [
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_000_000, source: 'proportional-fallback' as const },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 3_600_000, source: 'proportional-fallback' as const },
    ];

    expect(chapterPositionToAudioMs(anchors, { chapterIndex: 5, withinChapterFraction: 0.5 })).toBe(3_300_000);
  });

  it('interpolates a position inside a non-content divider', () => {
    const anchors = [
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_000_000, source: 'proportional-fallback' as const },
      { chapterIndex: 7, withinChapterFraction: 0, audioMs: 4_000_000, source: 'proportional-fallback' as const },
    ];

    expect(chapterPositionToAudioMs(anchors, { chapterIndex: 6, withinChapterFraction: 0 })).toBe(3_500_000);
  });

  it('clamps front matter to the first anchor', () => {
    const anchors = [
      { chapterIndex: 2, withinChapterFraction: 0, audioMs: 60_000, source: 'proportional-fallback' as const },
      { chapterIndex: 3, withinChapterFraction: 0, audioMs: 120_000, source: 'proportional-fallback' as const },
    ];

    expect(chapterPositionToAudioMs(anchors, { chapterIndex: 0, withinChapterFraction: 0.9 })).toBe(60_000);
  });

  it('returns the last anchor for a single-anchor map', () => {
    const anchors = [
      { chapterIndex: 3, withinChapterFraction: 0, audioMs: 500_000, source: 'proportional-fallback' as const },
    ];

    expect(chapterPositionToAudioMs(anchors, { chapterIndex: 3, withinChapterFraction: 0.42 })).toBe(500_000);
  });

  it('uses t = 0 for a zero-length audio bracket', () => {
    const anchors = [
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 1_000_000, source: 'proportional-fallback' as const },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 1_000_000, source: 'proportional-fallback' as const },
    ];

    expect(chapterPositionToAudioMs(anchors, { chapterIndex: 5, withinChapterFraction: 0.5 })).toBe(1_000_000);
  });

  it('round-trips stable positions within the anchored range', () => {
    const anchors = [
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_000_000, source: 'proportional-fallback' as const },
      { chapterIndex: 5, withinChapterFraction: 0.5, audioMs: 3_400_000, source: 'confirmed' as const },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 3_600_000, source: 'proportional-fallback' as const },
    ];

    for (const position of [
      { chapterIndex: 5, withinChapterFraction: 0.25 },
      { chapterIndex: 5, withinChapterFraction: 0.75 },
    ]) {
      const audioMs = chapterPositionToAudioMs(anchors, position);
      const roundTripped = audioMsToChapterPosition(anchors, audioMs);
      expect(roundTripped.chapterIndex).toBe(position.chapterIndex);
      expect(roundTripped.withinChapterFraction).toBeCloseTo(position.withinChapterFraction, 9);
    }
  });
});

describe('audioMsToChapterPosition', () => {
  it('returns the expected midpoint between chapter anchors', () => {
    const anchors = [
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_000_000, source: 'proportional-fallback' as const },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 3_600_000, source: 'proportional-fallback' as const },
    ];

    expect(audioMsToChapterPosition(anchors, 3_450_000)).toEqual({ chapterIndex: 5, withinChapterFraction: 0.75 });
  });

  it('brackets a confirmed interior anchor correctly', () => {
    const anchors = [
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_000_000, source: 'proportional-fallback' as const },
      { chapterIndex: 5, withinChapterFraction: 0.5, audioMs: 3_400_000, source: 'confirmed' as const },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 3_600_000, source: 'proportional-fallback' as const },
    ];

    expect(audioMsToChapterPosition(anchors, 3_500_000)).toEqual({ chapterIndex: 5, withinChapterFraction: 0.75 });
  });

  it('clamps overshoot to the last anchor with fraction 1', () => {
    const anchors = [
      { chapterIndex: 2, withinChapterFraction: 0, audioMs: 60_000, source: 'proportional-fallback' as const },
      { chapterIndex: 3, withinChapterFraction: 0, audioMs: 120_000, source: 'proportional-fallback' as const },
    ];

    expect(audioMsToChapterPosition(anchors, 120_004)).toEqual({ chapterIndex: 3, withinChapterFraction: 1 });
  });

  it('returns the single anchor in both directions', () => {
    const anchors = [
      { chapterIndex: 3, withinChapterFraction: 0, audioMs: 500_000, source: 'proportional-fallback' as const },
    ];

    expect(audioMsToChapterPosition(anchors, 500_000)).toEqual({ chapterIndex: 3, withinChapterFraction: 0 });
  });

  it('uses the left entry for a corrupted zero-length bracket', () => {
    const anchors = [
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 1_000_000, source: 'proportional-fallback' as const },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 1_000_000, source: 'proportional-fallback' as const },
    ];

    expect(audioMsToChapterPosition(anchors, 1_000_000)).toEqual({ chapterIndex: 5, withinChapterFraction: 0 });
  });
});

describe('msToFilePosition', () => {
  it('walks into the second file', () => {
    expect(msToFilePosition(2_000_000, [1_800_000, 2_400_000])).toEqual({
      fileIndex: 1,
      fileSeconds: 200,
    });
  });

  it('clamps negative input to the start', () => {
    expect(msToFilePosition(-50, [1_800_000, 2_400_000])).toEqual({
      fileIndex: 0,
      fileSeconds: 0,
    });
  });

  it('clamps at or beyond the total duration', () => {
    expect(msToFilePosition(4_500_000, [1_800_000, 2_400_000])).toEqual({
      fileIndex: 1,
      fileSeconds: 2_400,
    });
  });
});

describe('percentage helpers', () => {
  it('converts percentage to audioMs', () => {
    expect(percentageToAudioMs(0.42, 10_000_000)).toBe(4_200_000);
  });

  it('converts audioMs to percentage', () => {
    expect(audioMsToPercentage(2_500_000, 10_000_000)).toBe(0.25);
  });
});

describe('refineChapterAnchor', () => {
  it('replaces a boundary anchor on key collision', () => {
    const input = [anchor(5, 0, 3_000_000)];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0, audioMs: 2_850_000 }, 4_000_000);

    expect(result).not.toBe(input);
    expect(result).toEqual([
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 2_850_000, source: 'confirmed' },
    ]);
    expectStrictAscending(result);
  });

  it('inserts an interior confirmation', () => {
    const input = [anchor(5, 0, 3_000_000), anchor(6, 0, 3_600_000)];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0.5, audioMs: 3_300_000 }, 4_000_000);

    expect(result).toEqual([
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_000_000, source: 'proportional-fallback' },
      { chapterIndex: 5, withinChapterFraction: 0.5, audioMs: 3_300_000, source: 'confirmed' },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 3_600_000, source: 'proportional-fallback' },
    ]);
    expectStrictAscending(result);
  });

  it('inserts a divider fraction-0 confirmation', () => {
    const input = [anchor(5, 0, 3_000_000), anchor(7, 0, 4_000_000)];
    const result = refineChapterAnchor(input, { chapterIndex: 6, withinChapterFraction: 0, audioMs: 3_550_000 }, 5_000_000);

    expect(result).toEqual([
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_000_000, source: 'proportional-fallback' },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 3_550_000, source: 'confirmed' },
      { chapterIndex: 7, withinChapterFraction: 0, audioMs: 4_000_000, source: 'proportional-fallback' },
    ]);
    expectStrictAscending(result);
  });

  it('supersedes a stale interior confirmation', () => {
    const input = [anchor(5, 0.5, 2_400_000, 'confirmed')];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0.3, audioMs: 2_520_000 }, 4_000_000);

    expect(result).toEqual([
      { chapterIndex: 5, withinChapterFraction: 0.3, audioMs: 2_520_000, source: 'confirmed' },
    ]);
    expect(result.filter((a) => a.chapterIndex === 5 && a.withinChapterFraction > 0).length).toBe(1);
    expectStrictAscending(result);
  });

  it('preserves a non-conflicting interior confirmation when correcting the boundary', () => {
    const input = [
      anchor(5, 0, 3_000_000),
      anchor(5, 0.5, 3_400_000, 'confirmed'),
    ];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0, audioMs: 2_850_000 }, 4_000_000);

    expect(result).toEqual([
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 2_850_000, source: 'confirmed' },
      { chapterIndex: 5, withinChapterFraction: 0.5, audioMs: 3_400_000, source: 'confirmed' },
    ]);
    expectStrictAscending(result);
  });

  it('discards a boundary-vs-interior conflict', () => {
    const input = [anchor(5, 0.5, 3_000_000, 'confirmed')];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_100_000 }, 4_000_000);

    expect(result).toBe(input);
  });

  it('discards a cross-chapter confirmed conflict', () => {
    const input = [anchor(6, 0, 3_600_000, 'confirmed')];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0, audioMs: 3_700_000 }, 4_000_000);

    expect(result).toBe(input);
  });

  it('applies a book-start confirmation', () => {
    const input: ReturnType<typeof refineChapterAnchor> = [];
    const result = refineChapterAnchor(input, { chapterIndex: 0, withinChapterFraction: 0, audioMs: 0 }, 4_000_000);

    expect(result).toEqual([
      { chapterIndex: 0, withinChapterFraction: 0, audioMs: 0, source: 'confirmed' },
    ]);
    expectStrictAscending(result);
  });

  it('walks backward and clamps the previous estimate', () => {
    const input = [anchor(4, 0, 2_100_000), anchor(5, 0, 2_900_000)];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0, audioMs: 2_000_000 }, 4_000_000);

    expect(result).toEqual([
      { chapterIndex: 4, withinChapterFraction: 0, audioMs: 1_999_999, source: 'proportional-fallback' },
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 2_000_000, source: 'confirmed' },
    ]);
    expectStrictAscending(result);
  });

  it('continues backward walk after a tie landing', () => {
    const input = [anchor(3, 0, 1_999_999), anchor(4, 0, 2_900_000)];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0, audioMs: 2_000_000 }, 4_000_000);

    expect(result).toEqual([
      { chapterIndex: 3, withinChapterFraction: 0, audioMs: 1_999_998, source: 'proportional-fallback' },
      { chapterIndex: 4, withinChapterFraction: 0, audioMs: 1_999_999, source: 'proportional-fallback' },
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 2_000_000, source: 'confirmed' },
    ]);
    expectStrictAscending(result);
  });

  it('walks forward from a confirmed entry', () => {
    const input = [anchor(6, 0, 3_900_000), anchor(7, 0, 3_950_000)];
    const result = refineChapterAnchor(input, { chapterIndex: 5, withinChapterFraction: 0, audioMs: 4_000_000 }, 4_500_000);

    expect(result).toEqual([
      { chapterIndex: 5, withinChapterFraction: 0, audioMs: 4_000_000, source: 'confirmed' },
      { chapterIndex: 6, withinChapterFraction: 0, audioMs: 4_000_001, source: 'proportional-fallback' },
      { chapterIndex: 7, withinChapterFraction: 0, audioMs: 4_000_002, source: 'proportional-fallback' },
    ]);
    expectStrictAscending(result);
  });

  it('deletes entries that cannot be clamped inside the synthetic bound', () => {
    const input = [anchor(1, 0, 5), anchor(2, 0, 10)];
    const result = refineChapterAnchor(input, { chapterIndex: 3, withinChapterFraction: 0, audioMs: 2 }, 100);

    expect(result).toEqual([
      { chapterIndex: 2, withinChapterFraction: 0, audioMs: 1, source: 'proportional-fallback' },
      { chapterIndex: 3, withinChapterFraction: 0, audioMs: 2, source: 'confirmed' },
    ]);
    expectStrictAscending(result);
  });
});
