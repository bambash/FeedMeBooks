# FeedMeBooks — Proof-of-Concept Plan (restart)

Status: agreed direction, 2026-09-28. Replaces the React Native app and the
`openspec/changes/rebuild-chapter-sync` design. Deliberately lean: this is a POC.

## The one job

**Handoff.** Stop listening, open the book, and land on the paragraph the
narrator was reading. Stop reading, press play, and hear the paragraph you were
on. One format at a time. Within-a-paragraph precision is the bar.

### Decisions

| Topic | Decision |
|---|---|
| Core moment | Handoff (Whispersync-style), not live read-along |
| Precision | Within a paragraph |
| Inputs | DRM-free EPUB + a folder of MP3s (track splits unrelated to chapters) |
| Platform | Android phone, single device, no accounts or cloud |
| Compute | On-device only |
| Switch UX | Offer, then jump ("Resume where you were listening?") |
| Stack | Native Kotlin: Compose, Readium Kotlin toolkit, Media3/ExoPlayer, whisper.cpp (JNI) |
| Codebase | Clean restart; port only ideas and fixtures |
| v1 scope | Library + import, handoff both ways, background audio + lockscreen controls |
| Cut from v1 | Stats/calendar, PDF/TXT, custom reader theming beyond Readium defaults |

## Why the old approach failed (and what changes)

The old design indexed the whole audiobook up front (full Whisper
transcription, then one anchor per chapter). The result was slow, gated behind a
manual "Build Index" button, and at best precise to a chapter. On top of that,
the WebView reader could only jump to chapter starts.

**New principle: don't index the book; find your place at the moment of
handoff.** Transcribe a short audio window only when a switch happens, then
locate it in the text. Every successful match is saved as an anchor, so later
switches start from a better estimate. There is no index step and no
full-book transcription.

## Core model

- **Book text coordinate:** one normalized plain-text string for the whole
  EPUB (spine order, HTML stripped, whitespace collapsed). A text position is a
  `charOffset` into that string. Keep a per-spine-item offset table so offsets
  convert to and from Readium `Locator`s (href + progression + text snippet).
- **Audio coordinate:** one global timeline `audioMs` across the ordered MP3
  playlist (`sum(durations of earlier tracks) + position in current track`).
  Track boundaries are irrelevant to sync.
- **Anchors:** `(charOffset, audioMs, source, createdAt)` pairs, sorted, with the
  implicit endpoints `(0, 0)` and `(totalChars, totalMs)`. The estimate in either
  direction is piecewise-linear interpolation between neighbouring anchors.
  Anchors that violate monotonicity with trusted neighbours are dropped.

## Handoff algorithms

The fuzzy matcher is the heart of the POC: pure Kotlin, no Android deps,
unit-tested on the JVM.

**Matcher.** Input: transcript words (with per-word ms) and a text window.
Output: aligned word pairs `(charOffset, audioMs)` plus a confidence score.
It runs a token-level local alignment (Smith–Waterman over normalized words,
tolerant of insertions, deletions and Whisper misspellings). The costs are
small: about 50 transcript words against a window of up to about 20k book words.

**Audio → text** (resume reading after listening)
1. `t` = current `audioMs`. Transcribe `[t − 20s, t]` with whisper.cpp (tiny.en
   or base.en, token timestamps on).
2. Estimate `c₀` from anchors, and search the text window `c₀ ± W`. W is wide when
   there are few anchors; if confidence is low, fall back to the whole book.
3. Take the matched char offset of the last transcript word, save an anchor,
   and resolve to the containing paragraph.
4. Offer: *"Resume where you were listening? '…It was a bright cold day in
   April…'"* → jump the Readium navigator to that locator and briefly
   decorate (highlight) the paragraph.

**Text → audio** (resume listening after reading)
1. Target `c` = char offset of the first fully visible paragraph.
2. Estimate `t₀` from anchors. Transcribe `[t₀ − 10s, t₀ + 10s]`, then match it
   against the text near `c`.
3. If the matched char range contains `c`, interpolate the exact `audioMs`.
   Otherwise, turn the match into a new anchor, re-estimate using the local
   speaking rate, and probe again (max 3 probes).
4. Offer: *"Start listening from this page?"* → seek the playlist to the
   corresponding track and position, starting slightly before (about 2s) for context.

**When to offer.** Store `lastReadAt` and `lastListenedAt`. On opening the
reader, offer an audio→text jump if listening is fresher. On pressing play,
offer a text→audio jump if reading is fresher. Show "Finding your place…"
while the probe runs (target < 5s).

## Architecture (single Gradle project in `native/`)

```
:core   pure Kotlin/JVM: text normalization, anchors, interpolation, matcher
        (all logic worth testing lives here, and runs in CI without an emulator)
:app    Compose UI, Readium navigator, Media3 MediaSessionService,
        whisper.cpp JNI, audio decode (MediaExtractor/MediaCodec → 16 kHz mono PCM),
        Room (books, tracks, anchors, last positions)
```

- **Import:** use the Storage Access Framework to pick an EPUB, then pick an MP3
  folder (`OpenDocumentTree`). Sort tracks by natural filename order (user can
  reorder). Persist URI permissions rather than copying files. Read durations at import.
- **Audio:** an ExoPlayer playlist inside a `MediaSessionService`, which gives
  background playback, lockscreen and notification controls for free.
- **Whisper model:** `ggml-tiny.en` (~75 MB), downloaded on first use.
  Upgrade to base.en if accuracy requires it.

## Build order

Spikes first, because each one kills the plan if it fails:

1. **S1 — matcher on JVM (`:core`).** Build and test it against synthetic
   transcripts: dropped words, misspellings, repeated phrases, and a wrong prior.
   This can be done without a device.
2. **S2 — whisper.cpp on device.** Transcribe a 20s MP3 slice on a real Android
   phone with token timestamps. Go/no-go: < 5s wall time with tiny.en.
3. **S3 — Readium navigation.** Jump to an arbitrary text locator (mid-chapter)
   and decorate a paragraph. Also read back the current visible locator → charOffset.

Then:

4. Library + import + ExoPlayer playlist with background/lockscreen controls.
5. Audio → text handoff end to end.
6. Text → audio handoff end to end.
7. Test on real books: pick 2–3 DRM-free EPUB + MP3 pairs (e.g. Standard Ebooks +
   LibriVox recordings of the same public-domain edition) and record switch accuracy.

## Known risks

- **Narration differs from text** (intros, credits, footnotes not read, front
  matter). The local alignment and the wide/fallback search window absorb this.
  Any leftover error just stays with a single probe.
- **Repeated phrases.** Break ties using distance from the anchor-based prior.
- **Whisper hallucinating on silence or music.** Drop low-confidence probes and
  retry a shifted window.
- **Readium text-locator precision.** If jumping by text snippet is unreliable,
  fall back to href + progression, which still lands within a screen or so.
  S3 answers this.

## Carried over from the old repo

- Test-fixture approach: generate TTS audio of a known EPUB, which gives
  ground-truth timings for integration tests of the matcher.
- Lessons: no full-book index, and no chapter-granularity model.
- The React Native app stays in git history (tag it `rn-final`) and is not maintained.
