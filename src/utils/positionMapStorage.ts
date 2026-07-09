/**
 * Persistent storage for AudiobookPositionMap objects.
 *
 * Stored separately from the main library store (which uses Zustand/persist)
 * to avoid bloating the primary storage key with potentially large JSON blobs.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AudiobookPositionMap } from '../types';

const key = (bookId: string) => `feedmebooks:positionmap:${bookId}`;

export async function savePositionMap(map: AudiobookPositionMap): Promise<void> {
  await AsyncStorage.setItem(key(map.bookId), JSON.stringify(map));
}

export async function loadPositionMap(bookId: string): Promise<AudiobookPositionMap | null> {
  const raw = await AsyncStorage.getItem(key(bookId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AudiobookPositionMap;
  } catch {
    return null;
  }
}

export async function deletePositionMap(bookId: string): Promise<void> {
  await AsyncStorage.removeItem(key(bookId));
}
