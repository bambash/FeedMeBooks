# FeedMeBooks

A mobile-first app for reading ebooks and listening to audiobooks — with seamless session tracking between both formats.

## Features

- **Dual-format support** — pair an ebook and audiobook for the same title
- **All common formats**
  - Ebook: `epub`, `pdf`, `txt`
  - Audio: `mp3`, `wav`, `m4a`, `m4b`, `aac`, `ogg`, `flac`, `opus`
- **Session persistence** — remembers your exact position in both ebook and audio independently
- **Seamless mode switching** — tap Read / Listen to swap without losing your place in either
- **Compact audio strip** — listen while reading; the audio player shows as a slim bar at the bottom of the ebook view
- **Reader settings** — dark/light mode, adjustable font size
- **Playback controls** — play/pause, skip ±15/30 s, playback speed (0.5× – 2×)

## Getting Started

### Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- iOS Simulator / Android Emulator **or** a physical device with [Expo Go](https://expo.dev/client)
  > **Note:** `react-native-pdf` requires a [development build](https://docs.expo.dev/develop/development-builds/introduction/) (EAS Build or local build). Epub and audio work in Expo Go.

### Install

```bash
npm install
```

### Run

```bash
# Expo Go (epub + audio only)
npx expo start

# Development build (full PDF support)
npx expo run:ios
npx expo run:android
```

## Project Structure

```
app/
  _layout.tsx          Root layout (SafeAreaProvider, Stack navigator)
  index.tsx            Library screen — grid of books
  reader/[id].tsx      Reader screen — ebook + audio with mode toggle

src/
  components/
    EbookReader/       epub / pdf / txt renderers
    AudioPlayer.tsx    Full and compact audio player
    BookCard.tsx       Library grid card
    AddBookModal.tsx   Sheet to add a new book
  store/
    libraryStore.ts    Zustand store persisted to AsyncStorage
  theme/index.ts       Design tokens (colors, spacing, typography)
  types/index.ts       Shared TypeScript types
  utils/fileUtils.ts   File picking, copying, formatting helpers
```

## How It Works

1. Tap **+ Add Book** and enter the title/author
2. Pick an ebook file and/or an audio file from your device
3. Optionally add a cover image
4. Tap the book to open the Reader
5. Switch between **Read** (ebook) and **Listen** (audio) tabs at any time
6. Your position in each format is saved automatically and resumed on next open

## Tech Stack

| Concern | Library |
|---|---|
| Framework | Expo (React Native) |
| Routing | Expo Router |
| State / Persistence | Zustand + AsyncStorage |
| Epub rendering | WebView + epub.js (CDN) |
| PDF rendering | react-native-pdf |
| Audio playback | expo-av |
| File picking | expo-document-picker |
| File storage | expo-file-system |
