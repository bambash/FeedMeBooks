# FeedMeBooks — native Android (POC)

See [`../docs/poc-plan.md`](../docs/poc-plan.md) for the plan and decisions.

## Modules

- `:core` — pure Kotlin/JVM. Holds the handoff logic, so it runs anywhere without an emulator.
  - `BookText`: the whole EPUB as one normalized string; converts between `charOffset`,
    words, paragraphs, and reader (section, progression) positions.
  - `AnchorMap`: piecewise-linear text ↔ audio mapping learned from confirmed matches.
  - `Matcher`: token-level Smith–Waterman that finds a noisy transcript in the book.
  - `Handoff`: `audioToText` / `textToAudio` built on a pluggable `Transcriber` (whisper.cpp in the app).
- `:app` — not yet created (Compose + Readium + Media3 + whisper.cpp).

## Test

```bash
./gradlew :core:test
```

Tests run against a simulated audiobook (`Simulation.kt`). It includes a narrator
intro, a skipped paragraph, drifting pace, and a fake Whisper that drops, misspells
and inserts words, so every result can be checked against the known true position.
