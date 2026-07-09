# Review Log — rebuild-chapter-sync

> **Redo note (2026-07-08):** The change was restarted at the user's request (model switch to Fable 5).
> All artifacts prior to the redo are superseded: the original proposal.md (frozen in the earlier
> round 1 below) was unfrozen and rewritten; the in-review design.md was deleted for re-authoring.
> Verified codebase facts discovered during the superseded design rounds (AudioPlayer seek mechanism,
> manual index-build button, EPUB bridge fraction limitation, CBA complexity, chapter-0 search,
> mid-book divider handling) were folded into explore-brief.md under "Verified codebase constraints"
> so the redo builds on them. Round numbering restarts per batch below.

## proposal Round 1 (redo) — 2026-07-08
### 🟡 Addressed
- Why §root-cause-4 said "most" of the ten deleted exports are test-only; brief inventory says four of ten → reworded to the exact count
### 🔴 Outstanding
- (none)

**Result: proposal.md frozen.** All root causes mapped to scope, all five agreed scope decisions present, no contradiction of verified codebase constraints, no scope creep.

## design Round 1 (redo) — 2026-07-08
### 🔴 Fixed
- §5 claimed the Build Index button hides for PDF/TXT but never specified the code change; verified `canBuildIndex` derives from format-agnostic `canEbook` → added explicit requirement: gate on `ebookFormat === 'epub'`
- §7 monotonicity guard discarded confirmed ground truth when a *neighboring estimate* was the wrong value → replaced with source-priority conflict resolution (confirmed wins over estimates via bounded clamp cascade; confirmed-vs-confirmed conflict discards the new one)
### 🟡 Addressed
- §4 zero-length-bracket rationale was backwards (step-6 clamp guarantees strict inequality) → reworded as defensive-only, unreachable from construction
- §7 replace-in-place neighbor check ambiguity → explicit: replaced entry excluded from its own neighbor comparison
- §10 test list updated to the new conflict-resolution semantics
### 🔴 Outstanding
- (none — superseded by round 2)

## design Round 2 (redo) — 2026-07-08
### 🔴 Fixed
- §7 cascade behavior unspecified when it reaches a `'confirmed'` entry beyond the immediate neighbor → rewrote as a total rule: confirmed-bounds check first (discard if outside nearest confirmed bounds / book range), then apply, then clamp violating estimates; degenerate no-room case deletes provably misplaced estimates; §2 density invariant softened to "at construction"
- §5 canBuildIndex formula referenced nonexistent `hasAudio` and dropped the real `mode === 'ebook'` conjunct → verified against source (reader line 744, canEbook/canAudio at 706–707) and restated as the exact existing expression plus one new conjunct
### 🟡 Addressed
- Cascade could theoretically leave [0, totalAudioMs] → covered by the same bounds rule (0/totalAudioMs are the outer bounds)
- §6 didn't acknowledge the existing component-local `audioMsToFilePosition` (~reader lines 481–499) → now explicitly replaced by the extracted pure util (also fixing its missing negative-input clamp)
### 🔴 Outstanding
- (none — superseded by round 3)

## design Round 3 (redo) — 2026-07-08
### 🔴 Fixed
- §7 claimed every audio→ebook confirmation is a key collision — false for non-content divider chapters (no anchor) → placement paths now selected by collision, not direction; divider fraction-0 confirmations take the insert path
- §7 insert-path bounds check ran before stale same-chapter confirmed entry removal, so a prior confirmation could block its own correction → procedure reordered: superseded entries identified and excluded first (step 1), bounds checked against surviving ground truth (step 2)
- §7 cascade tested violators against the fixed confirmedMs, allowing a clamp to land exactly on a previously non-violating entry (tie → zero-length bracket §4 calls unreachable) → replaced with an outward walk comparing each entry against its adjusted neighbor
### 🟡 Addressed
- Degenerate deletion branch didn't specify which violators are deleted → now exact: the entry the walk would push past the bound, walk continuing against the same surviving neighbor
- §10 test list expanded to cover all new §7 cases
### 🔴 Outstanding
- (none — superseded by round 4)

## design Round 4 (redo) — 2026-07-08
All four round-3 fixes verified sound by adversarial trace (walk termination and strict order proved, not just asserted). Two new defects:
### 🔴 Fixed
- §7 step 1 over-deleted: a boundary (replace-path) confirmation superseded the same chapter's valid interior confirmed entry with no actual conflict, contradicting §2's two-independent-slots invariant → supersession now path-specific (replace path supersedes only the collided entry; insert path supersedes only the same-chapter interior entry); ordering conflicts between the two slots resolve via the step-2 confirmed-bounds discard
### 🟡 Addressed
- §7 step 2's strict bounds wrongly discarded legitimate confirmations exactly at audioMs 0 or totalAudioMs → inclusive at synthetic ends, strict only against real confirmed neighbors
- Step 4's "realistic map" hedge upgraded to the reviewer's proof (bounds + deletion rule ⇒ walk terminates before any confirmed entry)
### 🔴 Outstanding
- (none — superseded by round 5)

## design Round 5 (redo) — 2026-07-08
Both round-4 fixes verified sound by trace (including the symmetric interior-vs-boundary conflict case and synthetic-bound tie scenarios). Full-document coherence, frozen-proposal consistency, and complete brief coverage all confirmed. Zero findings.
### 🔴 Outstanding
- (none)

**Result: design.md frozen.**

## specs Round 1 — 2026-07-08
Zero contradictions with frozen design.md; every constant/formula/worked example verified (arithmetic recomputed by reviewer). 7 findings, all missing-scenario coverage gaps:
### 🟡 Addressed
- sync-refinement: added scenarios for degenerate no-room deletion, forward-direction walk, boundary-vs-interior genuine conflict discard, and discard-does-not-persist
- position-sync: added scenarios for the percentage inverse direction, single-anchor map, zero-length corrupted bracket, and msToFilePosition upper-bound clamp
### 🔴 Outstanding
- (none — pending round 2 confirmation)

## specs Round 2 — 2026-07-08
All 8 added scenarios verified arithmetically correct and faithful to frozen design.md (7 findings → 8 scenarios: the single-anchor/zero-length finding split into two). No contradictions with round-1 content; files otherwise intact. Zero findings.
### 🔴 Outstanding
- (none)

**Result: specs/ frozen.**

## tasks Round 1 — 2026-07-08
39/41 spec scenarios traced to explicit tasks; constants, canBuildIndex conjunct, and scope faithfulness verified. 3 findings:
### 🟡 Addressed
- Percentage-path had no test/verification task → new 4.3 extracts pure percentage helpers with unit tests for both PS dispatch scenarios; 4.4 adds a startBuildIndex format guard implementing the never-transcribe SHALL; 5.2 extended with a TXT+audio manual check
- 4.2 too dense (both strategies + helper deletion) → split into 4.2 (chapter strategy) and 4.3 (percentage + helper deletion)
- 3.1 too dense (full 4-step procedure) → split into 3.1 (placement/supersession/bounds/apply) and 3.2 (order-restoration walk); tests renumbered to 3.3
### 🔴 Outstanding
- (none — superseded by round 2)

## tasks Round 2 — 2026-07-08
All 3 round-1 fixes verified sound; all 41 spec scenarios now trace to tasks; every task ≤2h; renumbering consistent. Two documentation nits (stale 2.1 test-file cross-reference → fixed to 2.3/2.5/2.6/3.3). Zero blockers.
### 🔴 Outstanding
- (none)

**Result: tasks.md frozen. Propose phase complete — all four artifacts (proposal, design, specs ×3, tasks) reviewed and frozen.**

## Superseded history (pre-redo)
- proposal Round 1 — passed clean, frozen (later unfrozen by redo).
- design Round 1 — 6 findings (confirmed-anchor type gap, 2 factual claims wrong vs source, chapter-0 hardcoding, divider clamping, msToFilePosition clamp); all fixed.
- design Round 2 — 1 🔴 (audio→ebook confirmations always fraction-0, colliding with boundary anchors; replace-in-place rule added), 1 🟡 (complexity claim corrected). Fixes applied but round-3 re-review never ran — superseded by redo.
