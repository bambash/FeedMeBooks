# Tasks: Rebuild Chapter Sync

Ordered for incremental compilability: types first, then the pure engine (test-driven against the frozen specs), then reader integration, then verification. Every task ≤ 2 hours. Spec references: CA = specs/chapter-alignment, PS = specs/position-sync, SR = specs/sync-refinement.

## 1. Types & storage

- [x] **1.1 Replace position types** (~1 h) — In `src/types/index.ts`: delete `PositionAnchor`, `PositionMap`, `SyncPoint`, `SyncMap`; add `ChapterAnchor`, `ChapterPosition`, `AudiobookPositionMap` exactly as design.md §2. Leave importing files temporarily broken (fixed by 1.2–4.5); get `src/types/` itself compiling.
- [x] **1.2 Rewrite positionMapStorage** (~1 h) — `src/utils/positionMapStorage.ts` persists/loads `AudiobookPositionMap` keyed by bookId (same AsyncStorage key scheme). Update `src/utils/__tests__/positionMapStorage.test.ts`: round-trip with mixed-source anchors (CA "Round trip"). No migration code.
- [x] **1.3 Delete legacy sync storage** (~0.5 h) — Remove `src/utils/syncMapStorage.ts`, `src/utils/__tests__/syncMapStorage.test.ts`, and their imports/uses in `app/reader/[id].tsx` (stub call sites with TODO(4.x) comments where needed to keep the tree buildable).

## 2. Alignment engine (`src/utils/alignSync.ts`)

- [x] **2.1 Clear superseded exports** (~0.5 h) — Delete the 10 superseded exports (design.md §9) and the internal `Anchor` type; keep `ChapterText`. Add named module constants: `BOUNDARY_PROBE_WORDS = 12`, `SEARCH_WINDOW_FRACTION = 0.15`, `SEARCH_WINDOW_MIN_MS = 90_000`, `MATCH_THRESHOLD = 0.6`, `CONTENT_CHAPTER_MIN_CHARS = 500`, `CANONICAL_EPSILON = 1e-9`. Delete the superseded test file content (rewritten in 2.3/2.5/2.6/3.3).
- [x] **2.2 Implement `buildChapterAnchors`** (~2 h) — CBA per design.md §3: content filtering, probe, proportional seed, bounded window (one-sided for first chapter), order-insensitive K-word set-overlap scoring, threshold → forced-alignment vs proportional-fallback, construction monotonicity guard, `builtFrom` derivation.
- [x] **2.3 Unit tests: buildChapterAnchors** (~2 h) — Synthetic `{audioMs, text}[]` fixtures covering every CA scenario: divider excluded, no content chapters, confident match, below-threshold fallback, first-chapter lead-in (≈45 s), backward-match rejection with strict ascending result, all-fallback → `builtFrom: 'unavailable'`.
- [x] **2.4 Implement conversions** (~1 h) — `chapterPositionToAudioMs` / `audioMsToChapterPosition` per design.md §4: canonical-key binary search, adjacent-pair linear interpolation, edge clamps (before-first, at/after-last incl. overshoot, single anchor, zero-length bracket `t = 0`).
- [x] **2.5 Unit tests: conversions** (~1.5 h) — Every PS conversion scenario: ebook→audio 3 300 000, audio→ebook 0.75, divider interpolation, confirmed-interior bracketing, front matter, overshoot → fraction 1, single-anchor both directions, corrupted zero-length bracket, round-trip stability property.
- [x] **2.6 Implement + test `msToFilePosition`** (~0.5 h) — Pure function per design.md §6 (ms in, `{fileIndex, fileSeconds}` out, both clamps). Tests: second-file walk (→ `{1, 200}`), negative input (→ `{0, 0}`), at/beyond total (→ `{1, 2400}`).

## 3. Refinement engine

- [x] **3.1 Implement refinement placement & guarded application** (~1.5 h) — Steps 1–3 of design.md §7: placement selection by canonical-key collision (replace-in-place vs insert), path-specific supersession (collided entry / same-chapter interior entry only), confirmed-bounds check (strict at real neighbors, inclusive at synthetic 0/`totalAudioMs`, discard → return input unchanged), apply. Order restoration stubbed as identity for now.
- [x] **3.2 Implement order-restoration walk** (~1 h) — Step 4 of design.md §7: outward walk from the new entry, adjusted-neighbor comparison, ±1 ms clamps with `'proportional-fallback'` re-marking and `confidence` drop, stop at first in-order entry, degenerate at-bound deletion continuing against the same surviving neighbor.
- [x] **3.3 Unit tests: refineChapterAnchor** (~2 h) — Every SR scenario: boundary collision-replace, interior insert, divider fraction-0 insert, stale-interior supersession (re-correction not blocked), boundary-preserves-interior, boundary-vs-interior conflict discard, cross-chapter confirmed-conflict discard, book-start `audioMs = 0` accepted, backward walk override, tie-landing continuation, forward walk (+1 ms), degenerate no-room deletion.

## 4. Reader integration (`app/reader/[id].tsx`)

- [x] **4.1 Rewire index build** (~1.5 h) — `startBuildIndex` assembles the global word stream (per-file `transcribeFile` results offset by cumulative prior durations — CA "Multi-file audiobook"), runs `buildChapterAnchors`, persists via `savePositionMap`, sets `positionMapCreatedAt`. Remove all calls to deleted alignSync exports; keep the build manual (no automatic effect).
- [x] **4.2 Rewire chapter-strategy mode switch** (~1.5 h) — EPUB books only: ebook→audio via existing `buildChapterPctMap` fraction → `chapterPositionToAudioMs` → `msToFilePosition` → existing `updateAudioPosition` + `audioPlayerKey` bump; audio→ebook via `audioMsToChapterPosition` → `goToChapter`. No new AudioPlayer API.
- [x] **4.3 Implement percentage-strategy path** (~1 h) — Extract pure helpers `percentageToAudioMs(pct, totalAudioMs)` / `audioMsToPercentage(audioMs, totalAudioMs)` (clamped to [0, 1] / [0, total]) in `alignSync.ts` with unit tests for both PS dispatch scenarios (0.42 → 4 200 000; 2 500 000 → 0.25). Wire both switch directions for pdf/txt books through them, `totalAudioMs` from summing `audioFileDurations`. Delete the component-local `audioMsToFilePosition` (~lines 481–499).
- [x] **4.4 Gate Build Index by strategy** (~0.5 h) — Add the single conjunct: `canBuildIndex={canEbook && canAudio && mode === 'ebook' && book.ebookFormat === 'epub'}` (reader line ~744), and add the same format guard as an early return in `startBuildIndex` — together these implement PS's "percentage books never load Whisper, never transcribe" (the button is the only transcription entry point; the guard is defense in depth for the same rule). Verify button absent for a TXT book, present for EPUB.
- [x] **4.5 Wire refinement to sync-banner accept** (~1 h) — On accept, call `refineChapterAnchor` with the confirmed triple and persist on success only (SR "Discard does not persist"); dismissal leaves the map untouched. No re-index trigger.
- [x] **4.6 Sweep & typecheck** (~0.5 h) — Remove remaining dead imports/TODO(4.x) stubs, `npx tsc --noEmit` clean, `grep` the deleted identifiers (design.md §9 list) — zero references outside `openspec/` (PS "Clean removal").

## 5. Verification

- [x] **5.1 Full test suite** (~0.5 h) — `npm test` green.
- [ ] **5.2 Pipeline E2E with sine fixtures** (~1.5 h) — Run `.maestro/01-build-sync-index.yaml` (or manual equivalent in dev build): indexing completes on `test-fixtures/` (lorem-ipsum.epub + tone WAVs), map persists with `builtFrom: 'unavailable'` (CA "Untranscribable audio"), sync banner appears, mode switch lands proportionally. Also add a TXT+audio book (any small .txt + one tone WAV): verify no Build Index button appears, both switch directions land at matching percentages, and no Whisper model download/transcription is triggered.
- [ ] **5.3 Real-audiobook accuracy check + constant tuning** (~2 h) — Manual: index a real narrated audiobook+EPUB pair; check per-chapter anchor accuracy (spot-check ≥5 chapters against actual narration), exercise both switch directions and one confirmed refinement. Tune `MATCH_THRESHOLD` / `SEARCH_WINDOW_*` / `BOUNDARY_PROBE_WORDS` only if accuracy is poor; record chosen values and observed accuracy in the change's notes before archive.
