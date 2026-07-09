# Spec: sync-refinement

Progressive improvement of the position map from user-accepted sync jumps. Replaces `addConfirmedAnchor`.

## ADDED Requirements

### Requirement: Refinement trigger
`refineChapterAnchor` SHALL run when the user accepts a sync jump via the existing sync-banner interaction, using the confirmed `{ chapterIndex, withinChapterFraction, audioMs }` at that moment. Audio→ebook confirmations always carry `withinChapterFraction: 0` (the EPUB bridge's `goToChapter` takes only a chapter index); ebook→audio confirmations carry the genuine fraction from `buildChapterPctMap`. No refinement SHALL ever trigger an automatic re-index; the manual Rebuild button remains the only full-recompute path.

#### Scenario: Acceptance refines, rejection does not
- **GIVEN** a sync banner offering a jump
- **WHEN** the user accepts
- **THEN** the map is refined and persisted; **WHEN** the user dismisses, **THEN** the map is untouched

### Requirement: Placement by key collision
Placement SHALL be selected by canonical-key collision (epsilon `1e-9`), not by direction. On collision: replace the entry in place — keep its `chapterIndex`/`withinChapterFraction`, set `audioMs` to the confirmed value, `source: 'confirmed'`, drop `confidence`. On no collision: insert a new `'confirmed'` entry in canonical order.

#### Scenario: Boundary correction (collision)
- **GIVEN** chapter 5's boundary anchor `(c=5.0, 3 000 000, 'proportional-fallback')` and an audio→ebook confirmation `{ chapterIndex: 5, withinChapterFraction: 0, audioMs: 2 850 000 }`
- **WHEN** refinement runs
- **THEN** the entry becomes `(c=5.0, 2 850 000, 'confirmed')`

#### Scenario: Interior insert (no collision)
- **GIVEN** an ebook→audio confirmation `{ chapterIndex: 5, withinChapterFraction: 0.5, audioMs: 3 300 000 }` and no entry at `c=5.5`
- **WHEN** refinement runs
- **THEN** a `'confirmed'` entry is inserted at `c=5.5`, splitting chapter 5's interpolation into two segments

#### Scenario: Divider chapter confirmation (no collision at fraction 0)
- **GIVEN** anchors at `c=5.0` and `c=7.0` only, and an audio→ebook confirmation `{ chapterIndex: 6, withinChapterFraction: 0, audioMs: 3 550 000 }`
- **WHEN** refinement runs
- **THEN** a `'confirmed'` entry is inserted at `c=6.0`

### Requirement: Path-specific supersession
Before any comparison, the refinement SHALL identify superseded entries — replace path: the collided entry only; insert path: the same chapter's existing interior `'confirmed'` entry at a different fraction only (at most one interior refinement per chapter) — exclude them from all bounds/neighbor computations, and delete them on apply. A boundary confirmation SHALL NOT supersede the same chapter's interior confirmed entry: each chapter has two independent confirmed slots (boundary, interior).

#### Scenario: Re-correction not blocked by its own stale value
- **GIVEN** chapter 5 has an interior confirmed entry `(c=5.5, 2 400 000)` and the user newly confirms `{ chapterIndex: 5, withinChapterFraction: 0.3, audioMs: 2 520 000 }`
- **WHEN** refinement runs
- **THEN** the stale `c=5.5` entry is superseded (excluded from bounds), the new entry is applied at `c=5.3`, and exactly one interior confirmed entry remains for chapter 5

#### Scenario: Boundary correction preserves interior entry
- **GIVEN** chapter 5 has both a boundary anchor at `c=5.0` and a non-conflicting interior confirmed entry at `c=5.5`
- **WHEN** a boundary confirmation for chapter 5 is applied
- **THEN** the interior entry survives unchanged

### Requirement: Confirmed-bounds check
Among surviving entries, the nearest `'confirmed'` entries before and after the new point's canonical position define `lowMs` (default `0`) and `highMs` (default `totalAudioMs`). The confirmed `audioMs` SHALL be strictly between real confirmed neighbors but inclusive at the synthetic `0`/`totalAudioMs` defaults. Otherwise the refinement SHALL be discarded with the map unchanged — a confirmation contradicting surviving ground truth signals browsing, not correction.

#### Scenario: Conflicting ground truths discard the newcomer
- **GIVEN** chapter 6 has a confirmed boundary at `audioMs = 3 600 000` and the user confirms chapter 5's boundary at `audioMs = 3 700 000`
- **WHEN** refinement runs
- **THEN** the map is returned unchanged

#### Scenario: Confirmation exactly at book start
- **GIVEN** no confirmed entries exist and the user confirms chapter 0's boundary at `audioMs = 0`
- **WHEN** refinement runs
- **THEN** it is applied, not discarded

#### Scenario: Boundary confirmation conflicting with its own chapter's interior entry
- **GIVEN** chapter 5 has an interior confirmed entry `(c=5.5, 3 000 000)` and the user confirms chapter 5's boundary (`c=5.0`) at `audioMs = 3 100 000`
- **WHEN** refinement runs
- **THEN** the interior entry (not superseded by a replace-path confirmation) is the following confirmed bound, `3 100 000` is not strictly below `highMs = 3 000 000`, and the refinement is discarded with the map unchanged

### Requirement: Order restoration walk
After applying, the refinement SHALL restore strict `audioMs` order by walking outward from the new entry, comparing each estimated entry against its adjusted neighbor (not the fixed confirmed value): backward violators are set to `neighborMs − 1`, forward violators to `neighborMs + 1`, each re-marked `'proportional-fallback'` with `confidence` dropped; the walk stops at the first in-order entry. If a clamp would place an entry at or past `lowMs`/`highMs`, that entry SHALL be deleted and the walk continues against the same surviving neighbor. The result SHALL always be strictly ascending in both `audioMs` and canonical key, with all `'confirmed'` entries untouched.

#### Scenario: Ground truth overrides a wrong estimate
- **GIVEN** estimated anchors `(c=4.0, 2 100 000)`, `(c=5.0, 2 900 000)` and a confirmed chapter-5 boundary at `audioMs = 2 000 000`
- **WHEN** refinement runs
- **THEN** `c=5.0` becomes `(2 000 000, 'confirmed')` and `c=4.0` is clamped to `(1 999 999, 'proportional-fallback')`

#### Scenario: Clamp landing on a previously in-order entry
- **GIVEN** estimated anchors at `1 999 999` (c=3.0) and `2 900 000` (c=4.0), and a confirmed chapter-5 boundary at `2 000 000`
- **WHEN** the backward walk clamps `c=4.0` to `1 999 999`, tying with `c=3.0`
- **THEN** the walk continues: `c=3.0` is clamped to `1 999 998`, and strict order holds

#### Scenario: Forward walk
- **GIVEN** estimated anchors `(c=6.0, 3 900 000)` and `(c=7.0, 3 950 000)`, and a confirmed chapter-5 boundary at `audioMs = 4 000 000`
- **WHEN** refinement runs
- **THEN** the forward walk clamps `c=6.0` to `4 000 001` and `c=7.0` to `4 000 002`, both re-marked `'proportional-fallback'` with `confidence` dropped

#### Scenario: Degenerate no-room deletion
- **GIVEN** no confirmed entries, estimated anchors `(c=1.0, 5)` and `(c=2.0, 10)`, and a confirmed chapter-3 boundary at `audioMs = 2`
- **WHEN** the backward walk runs (`lowMs = 0` synthetic bound)
- **THEN** `c=2.0` is clamped to `1` (`'proportional-fallback'`), `c=1.0` would clamp to `0 = lowMs` and is deleted, and the surviving entries are strictly ascending

### Requirement: Refinement persistence
A successful refinement SHALL persist the updated map via `positionMapStorage.savePositionMap`. A discarded refinement SHALL NOT write.

#### Scenario: Persisted after accept
- **GIVEN** a successful boundary correction
- **WHEN** the app restarts and the map reloads
- **THEN** the corrected anchor is present

#### Scenario: Discard does not persist
- **GIVEN** a refinement discarded by the confirmed-bounds check
- **WHEN** the app restarts and the map reloads
- **THEN** the map is byte-identical to its pre-refinement state (`savePositionMap` was never called)
