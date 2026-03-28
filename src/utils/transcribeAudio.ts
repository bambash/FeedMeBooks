/**
 * On-device audio transcription using whisper.rn (whisper.cpp bindings).
 *
 * Provides word-level timestamp segments used to build audio↔ebook sync maps.
 * The GGML model file (~77 MB for tiny.en) is downloaded once to app storage.
 *
 * Timestamp units: whisper.cpp reports t0/t1 in centiseconds (1/100 s).
 * We multiply by 10 to get milliseconds throughout this module.
 */

import * as FileSystem from 'expo-file-system';
import { initWhisper, type WhisperContext } from 'whisper.rn';

// ─── Model constants ────────────────────────────────────────────────────────

const MODEL_DIR = `${FileSystem.documentDirectory}whisper/`;
const MODEL_FILENAME = 'ggml-tiny.en.bin';
export const MODEL_PATH = `${MODEL_DIR}${MODEL_FILENAME}`;

// Hosted on Hugging Face — ggerganov's whisper.cpp model repo
const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single word/token segment from Whisper, with ms timestamps */
export interface TranscribeSegment {
  /** Start time in milliseconds (within the transcribed file) */
  t0Ms: number;
  /** End time in milliseconds */
  t1Ms: number;
  /** Recognized word or phrase (may include leading space) */
  text: string;
}

// ─── Model download ─────────────────────────────────────────────────────────

/** Returns true if the model binary exists on device */
export async function isModelDownloaded(): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(MODEL_PATH);
  return info.exists;
}

/**
 * Downloads the Whisper tiny-en model if not already present.
 * @param onProgress  Called with 0–1 as download proceeds.
 */
export async function downloadModel(
  onProgress?: (progress: number) => void,
): Promise<void> {
  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });

  const info = await FileSystem.getInfoAsync(MODEL_PATH);
  if (info.exists) return;

  const dl = FileSystem.createDownloadResumable(
    MODEL_URL,
    MODEL_PATH,
    {},
    (dp) => {
      if (dp.totalBytesExpectedToWrite > 0) {
        onProgress?.(dp.totalBytesWritten / dp.totalBytesExpectedToWrite);
      }
    },
  );

  const result = await dl.downloadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    // Clean up partial download
    await FileSystem.deleteAsync(MODEL_PATH, { idempotent: true });
    throw new Error(`Model download failed with HTTP ${result?.status ?? 'unknown'}`);
  }
}

// ─── Whisper context (singleton) ────────────────────────────────────────────

let _ctx: WhisperContext | null = null;

async function getContext(): Promise<WhisperContext> {
  if (_ctx) return _ctx;
  _ctx = await initWhisper({ filePath: MODEL_PATH });
  return _ctx;
}

/** Release the loaded model from memory (call when done indexing) */
export function releaseWhisperContext(): void {
  _ctx?.release?.();
  _ctx = null;
}

// ─── Transcription ──────────────────────────────────────────────────────────

/**
 * Transcribes a single audio file using the on-device Whisper tiny-en model.
 * Returns word-level segments with timestamps in ms (relative to file start).
 *
 * Requires the model to be downloaded first via `downloadModel()`.
 *
 * @param audioUri    Local file URI (file://...) — supports mp3, m4a, wav, flac, ogg
 * @param onProgress  Called with 0–1 as transcription proceeds
 */
export async function transcribeFile(
  audioUri: string,
  onProgress?: (progress: number) => void,
): Promise<TranscribeSegment[]> {
  const ctx = await getContext();

  const { promise } = ctx.transcribe(audioUri, {
    language: 'en',
    maxLen: 1,           // one token per segment → finest granularity
    tokenTimestamps: true,
    onProgress: (p) => onProgress?.(p / 100),
  });

  const { segments } = await promise;

  // Convert centiseconds → milliseconds
  return segments.map((s) => ({
    t0Ms: s.t0 * 10,
    t1Ms: s.t1 * 10,
    text: s.text,
  }));
}
