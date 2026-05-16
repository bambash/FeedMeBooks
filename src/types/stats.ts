import type { ReaderMode } from './index';

export interface ReadingSession {
  id: string;
  bookId: string;
  startTime: number;
  endTime?: number;
  mode: ReaderMode;
  /** ebook: percentage 0-1; audio: cumulative seconds */
  startPosition: number;
  /** ebook: percentage 0-1; audio: cumulative seconds */
  endPosition?: number;
  /** Approximate pages read (PDF only; undefined for other formats) */
  pagesRead?: number;
  /** Milliseconds; computed when session ends */
  durationMs?: number;
}

export interface UserStats {
  totalReadingTimeMs: number;
  totalBooksRead: number;
  totalBooksCompleted: number;
  currentStreak: number;
  longestStreak: number;
  lastReadDate: string | null;
  dailyMinutes: Record<string, number>;
  totalPagesRead: number;
  totalAudioMinutes: number;
}

export const DEFAULT_STATS: UserStats = {
  totalReadingTimeMs: 0,
  totalBooksRead: 0,
  totalBooksCompleted: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastReadDate: null,
  dailyMinutes: {},
  totalPagesRead: 0,
  totalAudioMinutes: 0,
};
