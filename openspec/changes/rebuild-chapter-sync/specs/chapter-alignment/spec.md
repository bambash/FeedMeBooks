# Spec: chapter-alignment

Builds the `AudiobookPositionMap` for an EPUB+audiobook pair from word-level transcript timestamps. Replaces `buildSyncPoints`, `buildSyncPointsFromTranscripts`, and `createInitialAnchors`.

## ADDED Requirements

### Requirement: Content chapter filtering
The alignment engine SHALL consider only content chapters — chapters whose `text.trim().length >= 500` — when building anchors. Non-content spine items (part dividers, copyright pages, title pages) SHALL receive no anchor.

#### Scenario: Part divider excluded
- **GIVEN** chapters at spine indices 5, 6, 7 where index 6 is a "Part Two" page with 40 characters of text
- **WHEN** `buildChapterAnchors` runs
- **THEN** the resulting map contains boundary anchors for spine indices 5 and 7, and none for 6

#### Scenario: No content chapters
- **GIVEN** every chapter is below the 500-character threshold
- **WHEN** `buildChapterAnchors` runs
- **THEN** it returns an empty anchor list

### Requirement: Chapter Boundary Alignment matching
For each content chapter, in spine order and including the first, the engine SHALL: (1) tokenize the chapter's first `K = 12` words with `text.toLowerCase().match(/\b[a-z']{2,}\b/g)`; (2) compute the proportional seed `expectedMs = (cumCharsBefore / totalChars) × totalAudioMs`; (3) scan transcript positions whose `audioMs ∈ [max(0, expectedMs − W), expectedMs + W]` where `W = max(0.15 × totalAudioMs, 90 000)`; (4) score each position as `|probeSet ∩ set(next K transcript words)| / K` (order-insensitive set overlap); (5) select the best-scoring position. `K`, `W`'s coefficients, and the acceptance threshold SHALL be named module constants defined in one place.

#### Scenario: Confident match becomes a forced-alignment anchor
- **GIVEN** a chapter whose opening 12 words appear (score ≥ 0.6) at transcript position with `audioMs = 1 830 000`
- **WHEN** the chapter is aligned
- **THEN** its anchor is `{ chapterIndex, withinChapterFraction: 0, audioMs: 1 830 000, source: 'forced-alignment', confidence: <score> }`

#### Scenario: No confident match falls back proportionally
- **GIVEN** a chapter whose best window score is 0.4 (below the 0.6 threshold)
- **WHEN** the chapter is aligned
- **THEN** its anchor is `{ chapterIndex, withinChapterFraction: 0, audioMs: expectedMs, source: 'proportional-fallback' }` with no `confidence` field

#### Scenario: First chapter searches for lead-in
- **GIVEN** an audiobook with 45 seconds of title/publisher narration before chapter one's text begins
- **WHEN** the first content chapter is aligned
- **THEN** the search window is one-sided `[0, W]`, and a confident match anchors the chapter at ≈45 000 ms rather than 0

### Requirement: Construction monotonicity
If a chapter's resolved `audioMs` (matched or fallback) is less than or equal to the previous anchor's `audioMs`, the engine SHALL discard the match result and anchor the chapter at `max(expectedMs, previousAudioMs + 1)` with `source: 'proportional-fallback'`. The final anchor list SHALL be strictly ascending in `audioMs` and in canonical key (`chapterIndex + withinChapterFraction`) simultaneously.

#### Scenario: Backward match rejected
- **GIVEN** chapter 8 matches confidently at `audioMs = 3 000 000` and chapter 9's best match scores 0.7 at `audioMs = 2 900 000`
- **WHEN** chapter 9 is aligned
- **THEN** chapter 9's anchor is `proportional-fallback` at `max(expectedMs, 3 000 001)` and the map remains strictly ascending

### Requirement: Map provenance
The produced `AudiobookPositionMap` SHALL set `builtFrom: 'transcript'` if at least one anchor has `source: 'forced-alignment'`, and `builtFrom: 'unavailable'` otherwise.

#### Scenario: Untranscribable audio
- **GIVEN** audio whose transcript matches no chapter openings (e.g. the sine-tone test fixtures)
- **WHEN** the map is built
- **THEN** every anchor is `proportional-fallback` and `builtFrom` is `'unavailable'`, and the map is still usable for conversion

### Requirement: Global word stream assembly
The reader screen SHALL assemble the alignment input by transcribing each audio file with the existing `transcribeFile()` and offsetting each file's word timestamps by the cumulative duration of all prior files, producing one chronological `{ audioMs, text }[]` stream for the whole book.

#### Scenario: Multi-file audiobook
- **GIVEN** two audio files of 30 and 40 minutes
- **WHEN** the word stream is assembled
- **THEN** words from the second file carry `audioMs` values offset by 1 800 000 ms

### Requirement: Map persistence
`positionMapStorage` SHALL persist and load `AudiobookPositionMap` keyed by `bookId`, replacing the previous `PositionMap` shape outright with no migration. `BookSession.positionMapCreatedAt` SHALL continue to record build time.

#### Scenario: Round trip
- **GIVEN** a built map with mixed-source anchors
- **WHEN** it is saved and reloaded
- **THEN** the loaded map is deep-equal to the saved one
