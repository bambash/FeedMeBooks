# FeedMeBooks — native Android (POC)

See [`../docs/poc-plan.md`](../docs/poc-plan.md) for the plan and decisions.

## Modules

- `:core` — pure Kotlin/JVM. Holds the handoff logic, so it runs anywhere without an emulator.
  - `BookText`: the whole EPUB as one normalized string; converts between `charOffset`,
    words, paragraphs, and reader (section, progression) positions.
  - `AnchorMap`: piecewise-linear text ↔ audio mapping learned from confirmed matches.
  - `Matcher`: token-level Smith–Waterman that finds a noisy transcript in the book.
  - `Handoff`: `audioToText` / `textToAudio` built on a pluggable `Transcriber` (whisper.cpp in the app).
- `:app` — Android app. For now it's a spike screen that runs `:core` on the device
  (smoke test + matcher speed on a novel-length book). Readium, Media3 and whisper.cpp come next.

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
