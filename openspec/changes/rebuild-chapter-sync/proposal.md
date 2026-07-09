# Proposal: Rebuild Chapter Sync

## Why

FeedMeBooks exists to do one thing: when you stop listening to an audiobook and open the ebook (or vice versa), you land exactly where you left off. The current implementation cannot do this reliably, for four root causes confirmed by reading the code:

1. **The two sync directions disagree about what "position within a chapter" means.** The ebook side derives `withinChapterFraction` from real character-proportional chapter bounds. The audio side derives a same-named value by linearly blending raw chapter-index *numbers* between sparse anchors — a number that reflects anchor spacing, not position. Both flow through the same conversion functions, so a mode switch lands wrong except by coincidence. This is the "chapter tracking doesn't work" bug.
2. **The expensive part of the pipeline is wasted.** The app runs full on-device Whisper transcription with per-word timestamps, then never uses a single timestamp to locate a chapter boundary. Actual alignment is either whole-file vocabulary scoring (one anchor per audio *file* — which collapses to one anchor for the entire book in the common single-file case) or blind proportional allocation.
3. **Only EPUB has chapters at all.** PDF and TXT books silently degrade to raw-percentage sync with no explicit model, no tests, and no documentation of that behavior.
4. **Two generations of dead implementation remain wired in:** a legacy `SyncMap`/`SyncPoint` storage-and-migration path, a duplicate `Anchor` type bridged to `PositionAnchor` with unsafe casts that drop fields, and ten superseded exported alignment functions, four of which are called by nothing but their own tests.

The repo is greenfield with no external users and no data to preserve. The right move is to replace the sync engine outright, not patch the existing types.

## What Changes (in scope)

- **One canonical type model.** Replace `PositionAnchor`, `PositionMap`, `SyncPoint`, `SyncMap`, and `alignSync.ts`'s internal `Anchor` with a single set: `ChapterAnchor`, `ChapterPosition`, `AudiobookPositionMap`. `withinChapterFraction` gets one definition shared by both sync directions — proportional position between consecutive anchors — eliminating root cause 1 structurally rather than by patching call sites.
- **Chapter Boundary Alignment (CBA).** Replace the alignment algorithm: for each content chapter, search the already-computed word-level Whisper timestamps in a bounded window around the proportional estimate for the chapter's opening words, and anchor the chapter at the matched word's real timestamp. Chapters with no confident match individually fall back to a proportional anchor instead of failing the whole map. This finally spends the transcription cost on precision, and works for single-file audiobooks — the case the current code handles worst.
- **Explicit sync strategy per format,** derived from `ebookFormat` rather than stored: EPUB → chapter-anchor sync (transcription runs, index build offered); PDF/TXT → percentage-only sync as a first-class modeled path (`ebookPercentage ↔ audioMs/totalAudioMs`). Percentage books never load the Whisper model, never transcribe, and never show the Build Index button.
- **Progressive refinement, rebuilt on the corrected model.** Accepted mode switches contribute confirmed anchors that improve future conversions. The rebuilt semantics respect a verified platform constraint: audio→ebook jumps can only land at chapter starts (the EPUB WebView bridge takes no fractional target), so confirmations from that direction correct a chapter's boundary anchor in place, while ebook→audio confirmations can insert genuine interior anchors.
- **Deletion of the legacy layer:** `src/utils/syncMapStorage.ts` and its test, the deprecated types, the duplicate `Anchor` type, and all superseded `alignSync.ts` exports and their tests. No migration path — there is no data to migrate.

## Out of Scope

- **Heuristic chapter detection for PDF/TXT** (detecting "Chapter N" headings, font-size breaks). Rejected during explore as fragile across arbitrary documents; those formats stay percentage-only.
- **Extending the EPUB WebView bridge to fractional/CFI chapter targets.** Audio→ebook jumps continue to land at chapter starts in this change; the bridge limitation is accepted and designed around, not fixed.
- **Any change to the Whisper model, transcription pipeline, or model download flow.** CBA consumes the `TranscribeSegment[]` output `transcribeAudio.ts` already produces.
- **New UI surfaces**, including alignment-confidence indicators. Anchor confidence is stored for debugging but not shown. The existing manual Build Index / Rebuild settings button remains the only index-management UI.
- **Cloud sync, accounts, multi-device** — this is purely the on-device engine.

## Impact

- **Rewritten:** `src/utils/alignSync.ts`, the position/anchor types in `src/types/index.ts`, `src/utils/positionMapStorage.ts`, and the sync-related sections of `app/reader/[id].tsx`.
- **Deleted:** `src/utils/syncMapStorage.ts` + `src/utils/__tests__/syncMapStorage.test.ts`.
- **Tests:** `alignSync.test.ts` rewritten against the new API; `positionMapStorage.test.ts` updated to the new map shape.
- **Risks:** CBA's window/threshold constants are best-guess defaults needing tuning against real narration. The committed test fixtures are sine tones, which Whisper cannot transcribe — they validate pipeline plumbing (the existing Maestro flow) but not alignment accuracy, so accuracy verification is manual against a real audiobook. Both risks are resolved concretely in design.md.
- **No migration risk:** greenfield, no users.
