/**
 * Persistent cache for in-progress Whisper transcription.
 *
 * Segments are stored per-file so that if the app is closed or the user
 * navigates away mid-transcription, already-completed files don't need to
 * be re-processed on the next attempt.
 *
 * Storage layout:
 *   feedmebooks:transcription:{bookId}:meta
 *     → { audioUris: string[], completedIndices: number[] }
 *   feedmebooks:transcription:{bookId}:file:{i}
 *     → TranscribeSegment[]
 *
 * Call deleteTranscriptionCache() after the sync map is successfully built.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TranscribeSegment } from './transcribeAudio';

interface CacheMeta {
  audioUris: string[];
  completedIndices: number[];
}

const metaKey = (bookId: string) => `feedmebooks:transcription:${bookId}:meta`;
const fileKey = (bookId: string, i: number) => `feedmebooks:transcription:${bookId}:file:${i}`;

/**
 * Load cache metadata for a book.
 * Returns null if no cache exists or the stored audioUris don't match
 * (i.e. the file list has changed and the cache is stale).
 */
export async function loadCacheMeta(
  bookId: string,
  audioUris: string[],
): Promise<CacheMeta | null> {
  const raw = await AsyncStorage.getItem(metaKey(bookId));
  if (!raw) return null;
  try {
    const meta: CacheMeta = JSON.parse(raw);
    // Invalidate if file list changed
    if (
      meta.audioUris.length !== audioUris.length ||
      meta.audioUris.some((u, i) => u !== audioUris[i])
    ) {
      await deleteTranscriptionCache(bookId);
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

/** Load cached segments for a single file. Returns null if not cached. */
export async function loadCachedFileSegments(
  bookId: string,
  fileIndex: number,
): Promise<TranscribeSegment[] | null> {
  const raw = await AsyncStorage.getItem(fileKey(bookId, fileIndex));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TranscribeSegment[];
  } catch {
    return null;
  }
}

/** Persist completed segments for one file and mark it done in the meta record. */
export async function saveFileSegments(
  bookId: string,
  fileIndex: number,
  segments: TranscribeSegment[],
  audioUris: string[],
): Promise<void> {
  // Write segments
  await AsyncStorage.setItem(fileKey(bookId, fileIndex), JSON.stringify(segments));

  // Update (or create) meta record
  const raw = await AsyncStorage.getItem(metaKey(bookId));
  let meta: CacheMeta;
  try {
    meta = raw ? JSON.parse(raw) : { audioUris, completedIndices: [] };
  } catch {
    meta = { audioUris, completedIndices: [] };
  }
  if (!meta.completedIndices.includes(fileIndex)) {
    meta.completedIndices.push(fileIndex);
  }
  await AsyncStorage.setItem(metaKey(bookId), JSON.stringify(meta));
}

/** Remove all transcription cache keys for a book. */
export async function deleteTranscriptionCache(bookId: string): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `feedmebooks:transcription:${bookId}:`;
  const toRemove = allKeys.filter((k) => k.startsWith(prefix));
  if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
}
