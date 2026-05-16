/**
 * Persistent storage for PositionMap objects.
 *
 * Stored separately from the main library store to avoid bloating
 * the primary storage key with potentially large JSON blobs.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PositionMap } from '../types';

const key = (bookId: string) => `feedmebooks:positionmap:${bookId}`;

export async function savePositionMap(map: PositionMap): Promise<void> {
  await AsyncStorage.setItem(key(map.bookId), JSON.stringify(map));
}

export async function loadPositionMap(bookId: string): Promise<PositionMap | null> {
  const raw = await AsyncStorage.getItem(key(bookId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PositionMap;
  } catch {
    return null;
  }
}

export async function deletePositionMap(bookId: string): Promise<void> {
  await AsyncStorage.removeItem(key(bookId));
}
