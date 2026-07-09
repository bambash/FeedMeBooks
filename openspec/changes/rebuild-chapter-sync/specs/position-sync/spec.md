# Spec: position-sync

Bidirectional position conversion at mode-switch time, and the per-format sync-strategy dispatch. Replaces `interpolateCanonical`, `interpolateAudioMs`, `lookupByAudio`, `lookupByChapter`, `fillFilePositions`, and the component-local `audioMsToFilePosition`.

## ADDED Requirements

### Requirement: Sync strategy dispatch
The sync strategy SHALL be derived, never stored: `'chapter'` when `ebookFormat === 'epub'`, `'percentage'` for `'pdf'` and `'txt'`. Percentage-strategy books SHALL never load the Whisper model, never transcribe, and never build or persist an `AudiobookPositionMap`.

#### Scenario: PDF book switches modes
- **GIVEN** a PDF+audio book with `ebookPosition.percentage = 0.42` and `totalAudioMs = 10 000 000` (from summing `BookSession.audioFileDurations`)
- **WHEN** the user switches to audio
- **THEN** the target is `audioMs = 4 200 000` with no transcription or map involved

#### Scenario: Percentage inverse direction
- **GIVEN** the same book paused at `audioMs = 2 500 000`
- **WHEN** the user switches to ebook
- **THEN** the target ebook position is `percentage = 0.25`

#### Scenario: Build Index hidden for percentage books
- **GIVEN** a TXT+audio book open in ebook mode
- **WHEN** the reader settings render
- **THEN** the Build Index / Rebuild button is absent, because `canBuildIndex` (today `canEbook && canAudio && mode === 'ebook'` at `app/reader/[id].tsx:744`) gains exactly one conjunct: `&& book.ebookFormat === 'epub'`

#### Scenario: EPUB keeps manual build
- **GIVEN** an EPUB+audio book with no position map
- **WHEN** the reader opens
- **THEN** no automatic index build starts; building runs only when the user taps Build Index (existing `startBuildIndex`)

### Requirement: Canonical-key interpolation
Both conversion directions SHALL operate on the canonical key `c = chapterIndex + withinChapterFraction`, binary-searching the anchor list (sorted strictly ascending in both `c` and `audioMs`) for the bracketing pair and interpolating linearly between those two adjacent entries only. Lookups SHALL never key on `chapterIndex` alone.

#### Scenario: Ebook to audio
- **GIVEN** anchors `(c=5.0, 3 000 000 ms)` and `(c=6.0, 3 600 000 ms)` and an ebook position `{ chapterIndex: 5, withinChapterFraction: 0.5 }`
- **WHEN** `chapterPositionToAudioMs` runs
- **THEN** it returns `3 300 000`

#### Scenario: Audio to ebook
- **GIVEN** the same anchors and `audioMs = 3 450 000`
- **WHEN** `audioMsToChapterPosition` runs
- **THEN** it returns `{ chapterIndex: 5, withinChapterFraction: 0.75 }`

#### Scenario: Position inside a non-content divider
- **GIVEN** anchors at `c=5.0` and `c=7.0` (spine index 6 is an anchorless divider) and a position `{ chapterIndex: 6, withinChapterFraction: 0 }`
- **WHEN** `chapterPositionToAudioMs` runs
- **THEN** it interpolates at `c = 6.0`, halfway between the bracketing anchors' `audioMs`

#### Scenario: Confirmed interior anchor splits a chapter
- **GIVEN** anchors `(c=5.0, 3 000 000)`, `(c=5.5, 3 400 000, source: 'confirmed')`, `(c=6.0, 3 600 000)` and `audioMs = 3 500 000`
- **WHEN** `audioMsToChapterPosition` runs
- **THEN** it brackets between `c=5.5` and `c=6.0`, returning `{ chapterIndex: 5, withinChapterFraction: 0.75 }`

### Requirement: Conversion edge clamps
Queries before the first anchor SHALL return the first anchor's position (`withinChapterFraction: 0`) / `audioMs`; queries at or beyond the last anchor (including `audioMs >= totalAudioMs`) SHALL return the last anchor's `chapterIndex` with `withinChapterFraction: 1` / the last anchor's `audioMs`. A single-anchor list SHALL return that anchor with fraction 0 in both directions. A zero-length bracket (equal `audioMs` or equal `c` — reachable only from a corrupted persisted map, never from construction or refinement) SHALL use `t = 0`.

#### Scenario: Front matter
- **GIVEN** the first anchor is `(c=2.0, 60 000 ms)` and the ebook sits at `{ chapterIndex: 0, withinChapterFraction: 0.9 }`
- **WHEN** converting to audio
- **THEN** the result is `60 000 ms`

#### Scenario: End-of-playback overshoot
- **GIVEN** `audioMs = totalAudioMs + 4` from a float rounding at playback end
- **WHEN** converting to ebook
- **THEN** the result is the last anchor's `chapterIndex` with `withinChapterFraction: 1`

#### Scenario: Single-anchor map
- **GIVEN** `anchors = [(c=3.0, 500 000)]` (a one-content-chapter book)
- **WHEN** converting in either direction
- **THEN** the result is that anchor's `audioMs` / `{ chapterIndex: 3, withinChapterFraction: 0 }`

#### Scenario: Zero-length bracket from a corrupted map
- **GIVEN** a hand-corrupted persisted map containing two entries with equal `audioMs = 1 000 000`
- **WHEN** a conversion brackets between them
- **THEN** `t = 0` is used and the left entry's values are returned (no division by zero, no crash)

### Requirement: Global-ms to file position
A pure function `msToFilePosition(audioMs, fileDurationsMs)` SHALL convert a global audio time to `{ fileIndex, fileSeconds }` by walking cumulative durations, clamping `audioMs <= 0` to `{ fileIndex: 0, fileSeconds: 0 }` and `audioMs >=` total to the last index at that file's full duration. It SHALL replace the component-local `audioMsToFilePosition` in `app/reader/[id].tsx` (which takes seconds and lacks the negative clamp). Mode switches SHALL apply the result via the existing store-write mechanism (`updateAudioPosition` + `audioPlayerKey` remount) — no new AudioPlayer API.

#### Scenario: Second file
- **GIVEN** `fileDurationsMs = [1 800 000, 2 400 000]` and `audioMs = 2 000 000`
- **WHEN** `msToFilePosition` runs
- **THEN** it returns `{ fileIndex: 1, fileSeconds: 200 }`

#### Scenario: Negative input
- **GIVEN** `audioMs = −50`
- **WHEN** `msToFilePosition` runs
- **THEN** it returns `{ fileIndex: 0, fileSeconds: 0 }`

#### Scenario: Input at or beyond total duration
- **GIVEN** `fileDurationsMs = [1 800 000, 2 400 000]` and `audioMs = 4 500 000` (total is 4 200 000)
- **WHEN** `msToFilePosition` runs
- **THEN** it returns `{ fileIndex: 1, fileSeconds: 2400 }` (last file at its full duration)

### Requirement: Shared fraction semantics
`withinChapterFraction` SHALL have one meaning everywhere: proportional position between consecutive anchors on the canonical axis. The ebook side SHALL continue to derive it from `buildChapterPctMap`'s character-proportional chapter bounds; the audio side SHALL derive it only via `audioMsToChapterPosition`. No code path SHALL blend chapter-index numbers across anchors more than one chapter apart.

#### Scenario: Round trip stability
- **GIVEN** any `ChapterPosition` within anchored range
- **WHEN** converted to audio and back
- **THEN** the result equals the input (within floating-point tolerance)

### Requirement: Legacy sync layer removal
`SyncMap`, `SyncPoint`, `PositionAnchor`, `PositionMap`, `alignSync.ts`'s `Anchor`, `src/utils/syncMapStorage.ts`, and the superseded `alignSync.ts` exports (`buildSyncPoints`, `buildSyncPointsFromTranscripts`, `fillFilePositions`, `lookupByAudio`, `lookupByChapter`, `findChapterByWindowText`, `createInitialAnchors`, `addConfirmedAnchor`, `interpolateCanonical`, `interpolateAudioMs`) SHALL be deleted along with their tests. No migration code SHALL be written.

#### Scenario: Clean removal
- **GIVEN** the change is applied
- **WHEN** searching the source tree for the deleted identifiers
- **THEN** no references remain outside `openspec/`
