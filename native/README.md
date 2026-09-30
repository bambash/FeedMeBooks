# FeedMeBooks — native Android (POC)

See [`../docs/poc-plan.md`](../docs/poc-plan.md) for the plan and decisions.

## Modules

- `:core` — pure Kotlin/JVM. Holds the handoff logic, so it runs anywhere without an emulator.
  - `BookText`: the whole EPUB as one normalized string; converts between `charOffset`,
    words, paragraphs, and reader (section, progression) positions.
  - `AnchorMap`: piecewise-linear text ↔ audio mapping learned from confirmed matches.
  - `Matcher`: token-level Smith–Waterman that finds a noisy transcript in the book.
  - `Handoff`: `audioToText` / `textToAudio` built on a pluggable `Transcriber` (whisper.cpp in the app).
- `:app` — the Android app.
  - `library/`: the launcher. Adding a book copies in its EPUB (title, author, cover),
    then takes the audiobook folder (persisted permission, natural filename order).
    `BookStore` keeps one JSON record per book: both positions, their timestamps, and
    the learned anchors.
  - `playback/`: `PlaybackService` (Media3 session + ExoPlayer) plays the whole
    audiobook in the background with notification and lock-screen controls, saves
    the position, and runs the sleep timer (fades out over the last 20 s, then pauses).
    `PlayerLink` is the UI's handle on it, in global audiobook time.
  - `book/`: `BookActivity` is the Readium reader with a mini player, and offers the
    handoffs. `HandoffEngine` runs `:core` over Whisper and persists the anchors.
    `ReadAlong` follows the narrator while the audio plays: it highlights the sentence
    being read and turns the page (or scrolls) to keep it on screen, from a Whisper probe
    every half minute extrapolated at the narration rate (`NarratorTracker` in `:core`).
    `ContentsSheet` is the table of contents; `SleepTimerDialog` sets the timer.
  - `reader/ReaderSettings`: theme (system, light, sepia, dark), text size, paged or
    scrolled layout, and the follow-the-narrator switch. `ui/AppTheme` applies the theme
    to every screen; `ui/ReaderSettingsSheet` edits it (from the reader's "Aa" button or
    the library's gear).
  - `reader/PageProbe`: asks the rendered page what's on screen, because Readium's
    own answers were off by a page on a real book.
  - `whisper/`, `audio/`: whisper.cpp JNI, the model download, and MP4/MP3 decoding
    stitched across files.
  - `LabActivity` + `reader/ReaderSpikeActivity`: the spike screens (Whisper speed,
    handoff test, navigation test), reached from the library's "Lab" button.

## In the reader

- Tap the left or right edge of the page to turn it; tap the middle to hide or show the bar.
- **Aa** opens the reading settings; the list icon opens the table of contents.
- With an audiobook attached, pressing play follows the narrator: the sentence being read
  is highlighted and pages turn by themselves. Turning a page yourself pauses the
  following; "Back to the narrator" resumes it. Turn it off under Aa → Follow the narrator.
- The ⋮ menu has the handoffs ("Go to the narrator's position", "Play from this page")
  and the sleep timer.

## Test

```bash
./gradlew :core:test
```

Tests run against a simulated audiobook (`Simulation.kt`). It includes a narrator
intro, a skipped paragraph, drifting pace, and a fake Whisper that drops, misspells
and inserts words, so every result can be checked against the known true position.

## Get the APK

Every push that touches `native/` runs the **Native APK** workflow
(`.github/workflows/native-apk.yml`). Open the run in GitHub Actions and download the
`feedmebooks-poc-<sha>` artifact. It's a zip containing a single APK. Every build is
signed with the same committed POC key (`app/poc-signing.keystore`), so a new APK
installs over the previous one.

The Android SDK is needed to build `:app` locally. `./gradlew :app:assembleRelease`
writes the APK to `app/build/outputs/apk/release/`.
