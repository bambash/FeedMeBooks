# Explore Brief — Rebuild Chapter Sync

## Root causes (confirmed by reading code, not guessed)
1. **Fraction-scale mismatch across modes.** Ebook side computes `withinChapterFraction` from real char-proportional chapter bounds (`buildChapterPctMap`). Audio side (`interpolateCanonical`) computes a "fraction" by linearly blending **chapter index numbers** between two sparse anchors — an artifact of anchor spacing, not a real position. Both are stored in the same ref and cross-fed into `interpolateAudioMs`, which only understands the chapter-index-blend scale.
2. **Word-level Whisper timestamps are computed then discarded.** `transcribeFile()` produces per-word timestamps; nothing uses them to locate chapter boundaries. Real alignment is either whole-file vocab recall (`buildSyncPointsFromTranscripts`, one anchor per **audio file**, degenerates to 1 anchor for single-file audiobooks — the common case) or pure proportional/equal-allocation.
3. **Chapters only exist for EPUB.** PDF (`page`)/TXT (`scrollY`) silently fall back to percentage-only, undocumented.
4. **Dead/duplicate code from bolted-on iterations.** Parallel types `Anchor`/`PositionAnchor` bridged by unsafe casts; fully-wired legacy `SyncMap`/`SyncPoint`/`syncMapStorage.ts` migration path; unused exports `lookupByAudio`, `lookupByChapter`, `fillFilePositions`, `findChapterByWindowText`; `withinChapterFraction` hardcoded to `0` at every anchor construction site.

Greenfield, no external users → delete all of the above outright, no migration/back-compat shims.

## Alternatives rejected
| Alternative | Rejected because |
|---|---|
| Full O(N×M) Needleman-Wunsch/DTW word alignment over the whole book | Quadratic blowup infeasible on-device for 80k+ word transcripts/books |
| Keep `buildSyncPointsFromTranscripts` whole-file vocab recall | Anchor granularity is per-audio-file not per-chapter; degenerates to one anchor for single-file audiobooks |
| Heuristic chapter detection for PDF/TXT (headings, font-size breaks) | Fragile across arbitrary PDFs/TXTs; too much scope for this change (user decision) |
| Keep `Anchor`/`PositionAnchor` dual types | Root cause of the unsafe-cast bugs; replace with one canonical pair |
| Drop progressive confirmed-anchor refinement entirely | Good source of ground truth; keep, rewired onto correct fraction model (user decision) |
| Store `fileIndex`/`fileSeconds` on every anchor | `AudioPlayer` seeks per-loaded-file in seconds, but conversion from global `audioMs` is a stateless function of `audioFileDurations`, not anchor state — no need to duplicate |

## Final approach — labels, dimensions, mapping tables

**Sync strategy per book** (derived from `ebookFormat`, not stored):
| ebookFormat | syncStrategy | Needs transcription? | Needs chapterAnchors? |
|---|---|---|---|
| epub | chapter | yes | yes |
| pdf | percentage | no | no |
| txt | percentage | no | no |

**New/replacing types** (all in `src/types/index.ts`, replacing `PositionAnchor`, `PositionMap`, `SyncPoint`, `SyncMap`):
| Type | Fields |
|---|---|
| `ChapterAnchor` | `chapterIndex: number`, `audioMs: number`, `source: 'forced-alignment' \| 'proportional-fallback' \| 'confirmed'`, `confidence?: number` (0–1, forced-alignment only) |
| `ChapterPosition` | `chapterIndex: number`, `withinChapterFraction: number` (0–1, identical meaning on both sides: proportional position between this chapter's start-anchor and the next chapter's start-anchor) |
| `AudiobookPositionMap` | `bookId: string`, `createdAt: number`, `totalAudioMs: number`, `chapterAnchors: ChapterAnchor[]` (sorted by chapterIndex, one per content chapter), `builtFrom: 'transcript' \| 'unavailable'` |

**Deleted types:** `PositionAnchor`, `PositionMap`, `SyncPoint`, `SyncMap`, `Anchor` (from `alignSync.ts`).
**Deleted files:** `src/utils/syncMapStorage.ts`.
**Deleted exports from `alignSync.ts`:** `buildSyncPoints`, `buildSyncPointsFromTranscripts`, `fillFilePositions`, `lookupByAudio`, `lookupByChapter`, `findChapterByWindowText`, `createInitialAnchors`, `addConfirmedAnchor`, `interpolateCanonical`, `interpolateAudioMs`.

**Chapter Boundary Alignment (CBA) algorithm** — replaces all of the above with one function per content chapter boundary:
| Parameter | Value | Purpose |
|---|---|---|
| Boundary probe length `K` | 12 words | First K normalized words of chapter i's text, used as the match target |
| Search window `W` | ±15% of total audio duration, minimum ±90s | Bounds the search around the proportional estimate so matching stays near-linear cost, not quadratic |
| Match threshold | word-overlap ratio ≥ 0.6 over the K-word sliding window | Below this, boundary is `proportional-fallback` instead of `forced-alignment` |
| Monotonicity rule | resolved `audioMs` must exceed previous chapter's resolved `audioMs`, else discard and mark `proportional-fallback` | Prevents false-positive matches from moving chapter order backward |
| Word tokenization | lowercase, `\b[a-z']{2,}\b` (same regex already used in `alignSync.ts`) | Reuse existing normalization, no behavior change there |
| Content-chapter threshold | chapter text ≥ 500 chars (existing constant, unchanged) | Filters part-headers/copyright pages from the anchor list |

**Within-chapter fraction — same formula both directions:**
- Ebook → audio: `withinChapterFraction` from `buildChapterPctMap` (unchanged, already correct) → `audioMs = anchor[i].audioMs + fraction × (anchor[i+1].audioMs − anchor[i].audioMs)`.
- Audio → ebook: `fraction = (audioMs − anchor[i].audioMs) / (anchor[i+1].audioMs − anchor[i].audioMs)` → fed into existing ebook chapter-percentage navigation.
- Percentage-strategy books: `audioMs = ebookPercentage × totalAudioMs` and inverse, no anchors at all.

**Confirmed-anchor refinement:** on an accepted mode switch (or explicit correction), insert a `{chapterIndex, withinChapterFraction, audioMs, source:'confirmed'}` sub-point inside that chapter's span, splitting the linear interpolation into two segments for that chapter only. Persisted via `positionMapStorage`.

## Verified codebase constraints (confirmed against source during review rounds — the redo must respect these)
- `AudioPlayer.seek(seconds)` seeks only within the currently loaded file; there is no `(fileIndex, seconds)` seek API. Cross-file jumps work by writing the target into the store (`updateAudioPosition`) and bumping a remount key (`audioPlayerKey`) so `AudioPlayer` reloads at the new file/position.
- Index building is a **user-triggered settings button** (`startBuildIndex`, gated by `canBuildIndex`), not an automatic effect keyed on map absence. Keep it manual.
- `EpubReader`'s WebView bridge command `goToChapter` (in `epubHtml.ts`) accepts **only a chapter index** — no within-chapter fraction or CFI target. Consequence: audio→ebook jumps land at chapter starts, so confirmations from that direction always carry `withinChapterFraction: 0` and collide with the chapter's own boundary anchor — refinement must replace-in-place on canonical-key collision, and only ebook→audio confirmations can insert genuine interior anchors. Extending the bridge to fractional targets is out of scope.
- CBA's search window `W = max(0.15 × totalAudioMs, 90 s)` scales with book length, so cost is `O(N × 0.3 × totalWords)` — a constant-factor reduction over a full scan, not asymptotic independence. Fine on-device (~10⁵–10⁶ cheap set-overlap checks for a typical book), but don't claim window-bounded complexity.
- Chapter 0 must be searched too (one-sided window `[0, W]`), not hardcoded to `audioMs: 0` — real audiobooks have title/publisher lead-in.
- Mid-book non-content spine items (e.g. "Part Two" dividers under the 500-char threshold) get no anchor; positions inside them interpolate correctly anyway because lookups use the canonical key `chapterIndex + withinChapterFraction`, which falls between the bracketing content-chapter anchors.

## Cross-module data flow
1. `app/reader/[id].tsx` index-build effect fires only when `ebookFormat === 'epub'` and audio present and no `AudiobookPositionMap` yet.
2. `EpubReader` (via `epubHtml.ts` bridge) → chapter texts + TOC → `chapterTextStorage.saveChapterTexts(bookId, chapters)`.
3. `transcribeAudio.transcribeFile()` per audio file → `TranscribeSegment[]` (file-local ms) → reader screen offsets by cumulative prior-file duration → one global `{audioMs, text}[]` word stream for the whole book.
4. New `alignSync.buildChapterAnchors(transcriptWords, chapters, totalAudioMs): ChapterAnchor[]` runs CBA, returns one anchor per content chapter.
5. `positionMapStorage.savePositionMap(bookId, AudiobookPositionMap)` — new shape, old shape deleted, no migration.
6. Ebook→audio switch: `EpubReader` reports `{spineIndex, percentage}` → `buildChapterPctMap`-derived `ChapterPosition` → `alignSync.chapterPositionToAudioMs(chapterAnchors, position)` → convert `audioMs` to `(fileIndex, fileSeconds)` via a stateless helper over `audioFileDurations` → `AudioPlayer.seek(fileIndex, fileSeconds)`.
7. Audio→ebook switch: `AudioPlayer` reports `(fileIndex, fileSeconds)` → global `audioMs` → `alignSync.audioMsToChapterPosition(chapterAnchors, audioMs)` → `ChapterPosition` → `EpubReader` chapter-fraction navigation (inverse of step 6's ebook lookup).
8. Percentage-strategy (pdf/txt) books skip steps 2–5 entirely (no transcription run at all) — switch directly maps `ebookPosition.percentage ↔ audioMs / totalAudioMs`.
9. Confirmed-anchor refinement runs after step 6/7 on user-accepted switches, feeding back into step 5's stored map.

## Open questions
- Exact CBA constants (K, W, threshold) are best-guess defaults — may need tuning against a real sample audiobook.
- Whether to surface match confidence in the UI (e.g. a subtle indicator when a chapter's anchor is `proportional-fallback`) or keep it fully silent.
- Behavior when the ebook is positioned in front/back matter (chapters below the 500-char threshold, no anchor exists) — likely clamp to nearest content-chapter anchor, needs to be explicit in design.md.
- Whether a large confirmed-anchor correction should prompt a full re-index vs. just locally patch that chapter's segment.
- Test fixtures: `test-fixtures/` currently has `lorem-ipsum.epub` + sine-wave `track-0N.wav` (distinct tone per chapter, no real speech) — fine for pipeline-plumbing E2E (`.maestro/01-build-sync-index.yaml`) but Whisper can't transcribe tones, so CBA accuracy can't be validated against them. Need to decide: add a synthesized-speech fixture (e.g. TTS reading the exact lorem-ipsum chapter text, giving known ground-truth boundaries) for real CBA unit/integration coverage, or accept unit tests only exercise CBA against synthetic `TranscribeSegment[]` fixtures (as `alignSync.test.ts` does today) and treat real-audio accuracy as manually verified.
