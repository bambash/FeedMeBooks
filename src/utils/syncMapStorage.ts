/**
 * Persistent storage for SyncMap objects.
 *
 * Stored separately from the main library store (which uses Zustand/persist)
 * to avoid bloating the primary storage key with potentially large JSON blobs.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SyncMap } from '../types';

const key = (bookId: string) => `feedmebooks:syncmap:${bookId}`;

export async function saveSyncMap(map: SyncMap): Promise<void> {
  await AsyncStorage.setItem(key(map.bookId), JSON.stringify(map));
}

export async function loadSyncMap(bookId: string): Promise<SyncMap | null> {
  const raw = await AsyncStorage.getItem(key(bookId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncMap;
  } catch {
    return null;
  }
}

export async function deleteSyncMap(bookId: string): Promise<void> {
  await AsyncStorage.removeItem(key(bookId));
}
