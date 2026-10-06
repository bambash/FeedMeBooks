# FeedMeBooks privacy policy

*Last updated 2026-10-06*

FeedMeBooks is an Android app for reading an ebook and listening to its audiobook without
losing your place. This policy explains what the app does with your data. The short version:
everything stays on your phone, and we collect nothing.

## What the app stores, and where

- **Your books.** When you add a book, the app copies the EPUB file into its own private
  storage on your device and keeps a read-only link to the folder of audio files you chose.
  Audio files are never copied.
- **Your places.** Your reading and listening positions, the times you last read or listened,
  and the text-to-audio alignment points the app learns from your own book are saved as a
  small file per book in the app's private storage.
- **Your settings.** Theme, text size, layout and the follow-the-narrator switch are saved on
  the device.
- **The speech model.** On first use the app downloads a speech-recognition model (about
  75 MB) once and keeps it in its private storage.

All of this lives in the app's private directory on your phone. It is removed when you
uninstall the app, and you can remove a single book from its card in the library. If you have
Android backup turned on, Android may include the app's data in your device backup; that is
governed by Google's backup settings and privacy policy, not by this app.

## What leaves your phone

Nothing about you or your books. The app makes exactly one kind of network request: the
one-time download of the speech-recognition model from Hugging Face
(`huggingface.co`). Like any download, that request shows Hugging Face's servers your IP
address; their handling of server logs is covered by Hugging Face's privacy policy. The app
sends no book text, no audio, no positions and no identifiers anywhere.

Speech recognition runs entirely on your device. Audio from your audiobook is transcribed
locally to find your place in the text, and the transcript is discarded.

## What we do not do

- No accounts, no sign-in.
- No analytics, crash reporting, advertising or tracking SDKs.
- No data collection, sale or sharing of any kind.

## Permissions

- **Internet**: to download the speech model once.
- **Foreground service (media playback)**: to keep the audiobook playing with the screen off
  and show the player on the lock screen.

The app does not ask for storage, microphone, location or contacts permissions. Books and
audio folders are chosen through Android's own file picker, which grants the app read access
to just what you picked.

## Children

FeedMeBooks is a general-audience app and is not directed at children under 13. It collects
no personal information from anyone.

## Changes

If this policy changes, the new version will be published at the same address with a new
date at the top.

## Contact

Questions about this policy: open an issue at https://github.com/bambash/FeedMeBooks/issues.
