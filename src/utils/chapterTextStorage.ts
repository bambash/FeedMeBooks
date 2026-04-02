/**
 * Persistent storage for chapter text excerpts used in JIT audio-position matching.
 *
 * We store the first 2 000 chars of each chapter — enough for word-recall matching
 * without bloating AsyncStorage with the full book text.
 *
 * Keyed by bookId; cleared when a new sync map is built.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StoredChapterText {
  chapterIndex: number;
  /** Up to 2 000 chars of plain chapter text for recall-based matching */
  text: string;
}

const key = (bookId: string) => `feedmebooks:chaptertexts:${bookId}`;

export async function saveChapterTexts(
  bookId: string,
  chapters: StoredChapterText[],
): Promise<void> {
  const compact = chapters.map((c) => ({
    chapterIndex: c.chapterIndex,
    text: c.text.slice(0, 2000),
  }));
  await AsyncStorage.setItem(key(bookId), JSON.stringify(compact));
}

export async function loadChapterTexts(bookId: string): Promise<StoredChapterText[] | null> {
  const raw = await AsyncStorage.getItem(key(bookId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredChapterText[];
  } catch {
    return null;
  }
}

export async function deleteChapterTexts(bookId: string): Promise<void> {
  await AsyncStorage.removeItem(key(bookId));
}
