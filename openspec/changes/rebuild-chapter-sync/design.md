# Design: Rebuild Chapter Sync

## 1. Architecture overview

The sync engine is replaced end to end. For EPUB books (chapter strategy):

```
transcribeAudio.transcribeFile()             (unchanged)
        │  TranscribeSegment[] per file (file-local ms)
        ▼
app/reader/[id].tsx — offsets each file's segments by cumulative prior-file duration
        │  global word stream: { audioMs: number; text: string }[]
        ▼
alignSync.buildChapterAnchors()              (new — replaces buildSyncPoints / buildSyncPointsFromTranscripts / createInitialAnchors)
        │  ChapterAnchor[]
        ▼
positionMapStorage.savePositionMap()         (new shape: AudiobookPositionMap)
        │
        ▼
alignSync.chapterPositionToAudioMs() /
alignSync.audioMsToChapterPosition()         (new — replace interpolateCanonical / interpolateAudioMs)
        │
        ▼
switchMode in app/reader/[id].tsx
  audio→ebook: ChapterPosition → EpubReader goToChapter (chapter start — see §7 asymmetry)
  ebook→audio: audioMs → msToFilePosition() → updateAudioPosition + audioPlayerKey remount
```

PDF/TXT books (percentage strategy) never enter this pipeline: no transcription, no anchors, no stored map. `switchMode` converts directly, `ebookPosition.percentage ↔ audioMs / totalAudioMs` (§5).

Index building remains a **user-triggered settings action** (today's `startBuildIndex` button gated by `canBuildIndex`) — this change rewires what the button computes, not when it runs. There is no automatic build effect.

## 2. Types (`src/types/index.ts`)

Delete `PositionAnchor`, `PositionMap`, `SyncPoint`, `SyncMap` (and `alignSync.ts`'s internal `Anchor`). Add:

```ts
export interface ChapterAnchor {
  /** epub.js spine index (0-based) this anchor is within */
  chapterIndex: number;
  /** 0–1 position within that chapter. 0 for chapter-boundary anchors (§3);
   *  a real measured fraction only for interior 'confirmed' anchors (§7).
   *  chapterIndex + withinChapterFraction is the anchor's canonical key —
   *  the single sort/lookup axis (§4). */
  withinChapterFraction: number;
  /** Milliseconds from the start of the whole audiobook at this canonical position */
  audioMs: number;
  source: 'forced-alignment' | 'proportional-fallback' | 'confirmed';
  /** Word-overlap match score (0–1); present only when source === 'forced-alignment'.
   *  Stored for debugging, never surfaced in UI (§8). */
  confidence?: number;
}

export interface ChapterPosition {
  chapterIndex: number;
  /** 0–1, proportional position between this chapter's anchor and the next
   *  anchor. One definition shared by both sync directions — the structural
   *  fix for the cross-mode fraction mismatch. */
  withinChapterFraction: number;
}

export interface AudiobookPositionMap {
  bookId: string;
  createdAt: number; // unix ms
  totalAudioMs: number;
  /** Sorted ascending by canonical key (equivalently by audioMs — ascending
   *  order in both is an invariant enforced at construction (§3) and
   *  refinement (§7)). One boundary entry per content chapter at construction
   *  (text.trim().length >= 500, today's threshold; §7's degenerate conflict
   *  branch may later remove a provably misplaced one), plus at most one
   *  interior 'confirmed' entry per chapter. chapterIndex is NOT unique
   *  across entries; never look up by chapterIndex alone. */
  chapterAnchors: ChapterAnchor[];
  /** 'unavailable' when no chapter resolved as forced-alignment
   *  (every anchor is proportional-fallback) */
  builtFrom: 'transcript' | 'unavailable';
}
```

`BookSession.positionMapCreatedAt` keeps its existing role (drives the Build Index / Rebuild button label). `ChapterText` in `alignSync.ts` is kept as the chapter-input shape.

## 3. Chapter Boundary Alignment (CBA)

```ts
export function buildChapterAnchors(
  transcriptWords: { audioMs: number; text: string }[], // global timeline, chronological
  chapters: ChapterText[],
  totalAudioMs: number,
): ChapterAnchor[]
```

Content chapters = `chapters` filtered to `text.trim().length >= 500` (today's threshold, filters part-headers/copyright pages). For each content chapter `i` in order — **including the first** (real audiobooks have title/publisher lead-in, so chapter 0 is searched, not pinned to 0):

| Step | Rule |
|---|---|
| 1. Probe | Tokenize the first `K = 12` words of chapter `i`'s text with the existing normalization: `text.toLowerCase().match(/\b[a-z']{2,}\b/g)` |
| 2. Seed | `expectedMs = (cumCharsBeforeChapterI / totalChars) × totalAudioMs` (0 for the first chapter) |
| 3. Window | Candidate positions where `audioMs ∈ [max(0, expectedMs − W), expectedMs + W]`, `W = max(0.15 × totalAudioMs, 90_000)`. One-sided `[0, W]` for the first chapter. |
| 4. Match | For each transcript position `p` in the window: score = `|probeSet ∩ set(next K transcript words from p)| / K`. Order-insensitive set overlap — narration elides/reorders relative to print ("the" dropped, narrator asides). Keep the best-scoring `p`. |
| 5. Threshold | `bestScore >= 0.6` → `{ chapterIndex: i, withinChapterFraction: 0, audioMs: transcriptWords[bestP].audioMs, source: 'forced-alignment', confidence: bestScore }`. Else → same shape with `audioMs: expectedMs`, `source: 'proportional-fallback'`, no confidence. |
| 6. Monotonicity | If the resolved `audioMs <=` the previous anchor's `audioMs`, discard the match and use `max(expectedMs, prevAudioMs + 1)` with `source: 'proportional-fallback'`. One bad match must not reorder the timeline. |

`builtFrom = 'transcript'` if at least one anchor is `'forced-alignment'`, else `'unavailable'`.

**Non-content spine items between two content chapters** (e.g. a "Part Two" divider under the threshold) get no anchor — intentionally. A position inside one (say spine index 6 with anchors at 5 and 7) still interpolates correctly because lookups use the canonical key, which lands between the bracketing anchors (§4).

**Cost honesty:** `W` scales with `totalAudioMs`, so the window is a fixed *fraction* (~30% span) of the transcript, not a fixed size — total cost is `O(N × 0.3 × totalWords)` with a cheap `O(K)` set-overlap per candidate. For a typical book (≈30 chapters, ≈80k transcript words) that's on the order of 10⁵–10⁶ cheap checks: fine on-device, but not asymptotically independent of book length.

**Constants `K`, `W`, and the 0.6 threshold are best-guess defaults**, defined as named module constants in one place so tuning against real narration (a tasks.md verification step) touches no logic.

## 4. Position conversion

```ts
export function chapterPositionToAudioMs(anchors: ChapterAnchor[], pos: ChapterPosition): number
export function audioMsToChapterPosition(anchors: ChapterAnchor[], audioMs: number): ChapterPosition
```

Every anchor has canonical key `c = chapterIndex + withinChapterFraction`; `anchors` is sorted ascending by `c` and by `audioMs` simultaneously (invariant from §3/§7). Both functions binary-search for the bracketing pair `[left, right]` — by `c` in one direction, by `audioMs` in the other — then interpolate linearly:

- ebook→audio: `t = (c − c_left) / (c_right − c_left)`; `audioMs = left.audioMs + t × (right.audioMs − left.audioMs)`
- audio→ebook: `t = (audioMs − left.audioMs) / (right.audioMs − left.audioMs)`; `c = c_left + t × (c_right − c_left)`; then `chapterIndex = floor(c)`, `withinChapterFraction = c − chapterIndex`

Linear interpolation between *adjacent array entries* is coherent here precisely because anchors are dense — one per content chapter — so neighbors are at most one chapter apart. (The current bug: anchors are per-audio-file, neighbors can span many chapters, and interpolating chapter-index numbers across that gap produces garbage.)

Edge cases, both directions:
- Query before the first anchor (front matter) → first anchor's position/`audioMs`, fraction 0. Query after the last (back matter, or `audioMs >= totalAudioMs` from end-of-playback overshoot) → last anchor's `chapterIndex` with fraction 1 / last anchor's `audioMs`. Matches how `buildChapterPctMap` already treats non-content chapters on the ebook side.
- `anchors.length === 1` → that anchor, fraction 0; nothing to interpolate.
- Zero-length bracket (`right.audioMs === left.audioMs` or `c_right === c_left`) → `t = 0`. Note this is purely defensive against a corrupted persisted map: §3 step 6 and §7's conflict resolution both enforce *strict* ascending order, and §7's epsilon collision test prevents duplicate canonical keys, so neither construction path can actually produce a zero-length bracket.

## 5. Sync strategy dispatch

Derived, never stored: `syncStrategy = ebookFormat === 'epub' ? 'chapter' : 'percentage'`.

| | chapter (epub) | percentage (pdf/txt) |
|---|---|---|
| Transcription / Whisper model load | on user Build Index tap | never |
| `AudiobookPositionMap` | built + persisted | none |
| Build Index / Rebuild button | shown (existing `canBuildIndex` gate) | `canBuildIndex = false`, button hidden |
| ebook→audio | `ChapterPosition` (from existing `buildChapterPctMap`) → `chapterPositionToAudioMs` | `audioMs = ebookPosition.percentage × totalAudioMs` |
| audio→ebook | `audioMsToChapterPosition` → chapter jump | `percentage = audioMs / totalAudioMs` |

`totalAudioMs` for the percentage path comes from summing the existing `BookSession.audioFileDurations` — already tracked, no new plumbing.

**Required code change for the button row:** today's expression is `canBuildIndex={canEbook && canAudio && mode === 'ebook'}` (`app/reader/[id].tsx:744`, with `canEbook = Boolean(book.ebookUri && book.ebookFormat)` and `canAudio = Boolean(book.audioUris?.length)` at lines 706–707) — nothing in it discriminates by format, so implemented as-is PDF/TXT books would still show Build Index. Add exactly one conjunct, keeping the existing three (including the `mode === 'ebook'` display condition, which this change does not alter): `canBuildIndex={canEbook && canAudio && mode === 'ebook' && book.ebookFormat === 'epub'}`.

## 6. Global audioMs ↔ per-file position

`AudioPlayer.seek(seconds)` only seeks within the currently loaded file — there is no `(fileIndex, seconds)` API, and this change adds none. Cross-file jumps use today's existing mechanism unchanged: write the target into the store (`updateAudioPosition(fileIndex, seconds)`) and bump the `audioPlayerKey` remount key so the player reloads there. What changes is only how the target is computed:

```ts
export function msToFilePosition(
  audioMs: number,
  fileDurationsMs: number[],
): { fileIndex: number; fileSeconds: number }
```

Clamped at both ends: `audioMs <= 0` → `{ fileIndex: 0, fileSeconds: 0 }`; `audioMs >=` total → last index at that file's full duration. A single-point conversion invoked at the moment of a switch — anchors carry no `fileIndex`/`fileSeconds`, eliminating the stale-duplicate-field problem `fillFilePositions` had.

This is not a wholly new computation: `app/reader/[id].tsx` already has a component-local `audioMsToFilePosition` useCallback (~lines 481–499) doing the same walk, taking durations in *seconds* and lacking the negative-input clamp (a negative `audioMs` yields `fileIndex: 0` with negative `fileSeconds`). The new `msToFilePosition` **replaces** it: extract to `alignSync.ts` as a pure, unit-testable function taking durations in ms with both clamps, and delete the component-local callback in favor of direct calls.

## 7. Progressive refinement (confirmed anchors)

```ts
export function refineChapterAnchor(
  anchors: ChapterAnchor[],
  confirmed: { chapterIndex: number; withinChapterFraction: number; audioMs: number },
): ChapterAnchor[]
```

Fires when the user accepts a sync jump (the existing sync-banner accept interaction — UI unchanged), using the position pair at that moment.

**Directional asymmetry (verified constraint):** `EpubReader`'s bridge command `goToChapter` takes only a chapter index — no fraction/CFI target — so audio→ebook confirmations always carry `withinChapterFraction: 0`. Usually that collides with the target chapter's boundary anchor's canonical key; when the target chapter is a non-content divider with no anchor (§3), the fraction-0 key collides with nothing. Ebook→audio confirmations carry a genuine fraction from `buildChapterPctMap`. Hence two placement paths, selected by canonical-key collision — not by direction:

- **Key collision** (canonical key matches an existing entry within `1e-9`): **replace in place** — keep the entry's `chapterIndex`/`withinChapterFraction`, set its `audioMs` to the confirmed value, `source: 'confirmed'`, drop `confidence`. The common audio→ebook case: fraction 0 hitting the chapter's boundary anchor.
- **No collision**: **insert** `{ ...confirmed, source: 'confirmed' }` in canonical order. Reached by ebook→audio confirmations (interior fraction, splitting that chapter's interpolation into two segments) and by the audio→ebook divider case above — a confirmed entry at a divider's start is correct and genuinely refines the map.

**Refinement procedure — source-priority conflict resolution:** applying either path must preserve the dual-sorted invariant (§2) that binary search depends on. The procedure is total (every case decided) and treats `'confirmed'` entries as immovable ground truth while estimates (`'forced-alignment'`, `'proportional-fallback'`) yield to ground truth:

1. **Identify superseded entries.** Replace path: the collided entry itself. Insert path: any existing interior `'confirmed'` entry for the same chapter at a different fraction (at most one interior refinement per chapter, keeping the list bounded). These are exactly the entries this confirmation replaces — exclude them from every comparison below, and delete them at step 3. Note a boundary (replace-path) confirmation does **not** supersede the same chapter's interior confirmed entry: §2 gives each chapter two independent slots — one boundary, at most one interior — and a boundary correction carries no evidence against a valid interior one. (If the two genuinely conflict by ordering, the interior entry acts as a confirmed bound in step 2 and the new confirmation is discarded — the standard confirmed-vs-confirmed rule.)
2. **Bounds check against surviving ground truth.** Among the remaining entries, find the nearest `'confirmed'` entry before and after the new point's canonical position: `lowMs` = its `audioMs` (or `0` if none), `highMs` = likewise (or `totalAudioMs`). The confirmed `audioMs` must lie **strictly** between real confirmed neighbors, but **inclusively** at the synthetic ends (`>= 0` where `lowMs` defaulted to `0`, `<= totalAudioMs` where `highMs` defaulted) — a legitimate confirmation exactly at the book's start or end contradicts nothing. Otherwise, **discard the refinement and return `anchors` unchanged**: it contradicts surviving ground truth (or the book's time range), which signals browsing/jumping, not correction — and confirmed entries carry no lower trust rank that would justify silently overriding them. Because step 1 already excluded superseded entries, re-correcting a previously confirmed chapter works — a stale confirmation can never block its own replacement.
3. **Apply**: delete the superseded entries, then replace or insert per the placement paths above. Only *estimated* entries can now violate ordering, and only ones lying strictly between the confirmed bounds.
4. **Restore strict order by walking outward from the new entry.** Backward: each preceding entry's `audioMs` must be strictly less than the (possibly already adjusted) entry after it; if not, set it to that neighbor's `audioMs − 1ms`, re-mark it `source: 'proportional-fallback'`, drop its `confidence`, and continue; stop at the first entry already in order (everything beyond it is untouched). Forward: symmetric, with `+ 1ms`. Comparing each entry against its *adjusted* neighbor — not against the fixed confirmed value — guarantees strict order even when a clamp lands exactly on a previously non-violating entry's value. Clamping estimates rather than discarding the confirmation is deliberate: a user-accepted position is ground truth, the estimate is the thing refinement exists to correct, and fallback entries are by definition estimates, so the clamp invents no false precision. If the walk would set an entry's `audioMs` at or below `lowMs` (backward) / at or above `highMs` (forward), **delete that entry and continue the walk against the same surviving neighbor** — ground truth has established there is no room for it, and a provably misplaced estimate is worse than an absent one. This makes the whole procedure provably safe, not just empirically so: step 2 guarantees the new value lies within the confirmed bounds, and the deletion rule keeps every stored clamp strictly inside `(lowMs, highMs)`, so the walk terminates before ever touching a `'confirmed'` entry and strict ascending order holds among all survivors.

Deletion in that degenerate branch means §2's density claim is precisely: every content chapter has a boundary entry **at construction**; refinement may, in the degenerate case only, remove a provably misplaced one. Lookups are unaffected — §4 already brackets by canonical key across gaps (non-content dividers create the same situation from day one).

Persist via `positionMapStorage.savePositionMap` after a successful refinement. No automatic re-index ever fires from refinement, however large the disagreement — the manual Rebuild button (existing `handleRebuildIndex`) is the escape hatch. Extending the EPUB bridge to fractional targets (which would let audio→ebook confirmations carry real fractions) is out of scope per proposal.md.

## 8. Confidence surfacing

`source`/`confidence` are persisted for debugging only. No indicator, banner copy, or settings row in this change — per-chapter proportional fallback (§3 step 5) keeps sync usable without user-visible warnings, and proposal.md scopes new UI surfaces out.

## 9. Deletions

- **File:** `src/utils/syncMapStorage.ts` + `src/utils/__tests__/syncMapStorage.test.ts`. No migration.
- **Types:** `PositionAnchor`, `PositionMap`, `SyncPoint`, `SyncMap` (types/index.ts); `Anchor` (alignSync.ts).
- **Exports from `alignSync.ts`:** `buildSyncPoints`, `buildSyncPointsFromTranscripts`, `fillFilePositions`, `lookupByAudio`, `lookupByChapter`, `findChapterByWindowText`, `createInitialAnchors`, `addConfirmedAnchor`, `interpolateCanonical`, `interpolateAudioMs` — and their tests.

## 10. Testing

- **Unit** (`alignSync.test.ts`, rewritten): `buildChapterAnchors` (match, fallback, chapter-0 lead-in, monotonicity guard, non-content dividers), round-trip `chapterPositionToAudioMs`/`audioMsToChapterPosition` (including all §4 edge cases), `refineChapterAnchor` (collision-replace; interior-insert; divider-chapter fraction-0 insert; re-correcting a previously confirmed chapter — stale entry superseded, not blocking; confirmed-bounds discard; clamp walk both directions including a clamp landing on a previously non-violating entry's value; degenerate no-room deletion), `msToFilePosition` clamps including negative input. All against synthetic `{ audioMs, text }` word streams and `ChapterText[]` fixtures — deterministic, no audio files.
- **`positionMapStorage.test.ts`:** updated to `AudiobookPositionMap`.
- **Pipeline E2E:** the existing Maestro flow (`.maestro/01-build-sync-index.yaml`) with the sine-tone fixtures still validates that indexing completes and the sync banner appears. Whisper cannot transcribe sine tones, so those fixtures exercise the `'unavailable'`/all-fallback path — which is itself worth asserting.
- **Real-audio accuracy:** no TTS tool exists on this machine (checked: no espeak/say/festival, no Node TTS package) to synthesize a committable ground-truth fixture. CBA accuracy and constant tuning (§3) are verified manually against a real narrated audiobook as an explicit tasks.md step, not an automated test in this change.
