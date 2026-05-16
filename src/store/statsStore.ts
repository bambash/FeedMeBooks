import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { BookStats, ReadingSession, UserStats } from '../types';

const STORAGE_KEY = 'feedmebooks-stats';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function computeStreaks(uniqueDates: string[]): {
  currentStreak: number;
  longestStreak: number;
} {
  const sorted = [...uniqueDates].sort();
  if (sorted.length === 0) return { currentStreak: 0, longestStreak: 0 };

  // Longest streak — scan all dates
  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]).getTime();
    const curr = new Date(sorted[i]).getTime();
    if ((curr - prev) / 86_400_000 === 1) {
      run++;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 1;
    }
  }

  // Current streak — count backwards from the most recent date, but only if
  // the most recent date is today or yesterday
  const last = sorted[sorted.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (last !== today && last !== yesterday) {
    return { currentStreak: 0, longestStreak };
  }

  let currentStreak = 1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const curr = new Date(sorted[i + 1]).getTime();
    const prev = new Date(sorted[i]).getTime();
    if ((curr - prev) / 86_400_000 === 1) {
      currentStreak++;
    } else {
      break;
    }
  }

  return { currentStreak, longestStreak };
}

interface StatsState {
  sessions: ReadingSession[];
  completedBooks: Set<string>;

  startSession: (
    bookId: string,
    mode: 'ebook' | 'audio',
    chapterIndex: number,
  ) => string;
  endSession: (sessionId: string, chapterEnd?: number) => void;
  markBookCompleted: (bookId: string) => void;
  getBookStats: (bookId: string) => BookStats;
  getGlobalStats: () => UserStats;
}

export const useStatsStore = create<StatsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      completedBooks: new Set<string>(),

      startSession: (bookId, mode, chapterIndex) => {
        const id = generateId();
        const session: ReadingSession = {
          id,
          bookId,
          startTime: Date.now(),
          mode,
          chapterStart: chapterIndex,
        };
        set((state) => ({ sessions: [...state.sessions, session] }));
        return id;
      },

      endSession: (sessionId, chapterEnd) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  endTime: Date.now(),
                  durationMs: Date.now() - s.startTime,
                  chapterEnd: chapterEnd ?? s.chapterEnd,
                }
              : s,
          ),
        }));
      },

      markBookCompleted: (bookId) => {
        set((state) => {
          if (state.completedBooks.has(bookId)) return state;
          const next = new Set(state.completedBooks);
          next.add(bookId);
          return { completedBooks: next };
        });
      },

      getBookStats: (bookId) => {
        const state = get();
        const bookSessions = state.sessions.filter(
          (s) => s.bookId === bookId && s.endTime != null,
        );
        let totalReadingMs = 0;
        let totalListeningMs = 0;
        for (const s of bookSessions) {
          const dur = s.durationMs ?? 0;
          if (s.mode === 'ebook') totalReadingMs += dur;
          else totalListeningMs += dur;
        }

        const lastSession = [...bookSessions].sort(
          (a, b) => (b.endTime ?? 0) - (a.endTime ?? 0),
        )[0];

        return {
          bookId,
          totalReadingMs,
          totalListeningMs,
          sessions: bookSessions.length,
          lastPosition: 0, // caller should update with current position
          completed: state.completedBooks.has(bookId),
        };
      },

      getGlobalStats: () => {
        const state = get();
        let totalReadingMs = 0;
        let totalListeningMs = 0;
        const startedBookIds = new Set<string>();
        const dateCounts: Record<string, number> = {};
        let lastReadDate: string | undefined;

        for (const s of state.sessions) {
          startedBookIds.add(s.bookId);
          if (s.endTime) {
            const dur = s.durationMs ?? 0;
            if (s.mode === 'ebook') totalReadingMs += dur;
            else totalListeningMs += dur;

            const dateKey = new Date(s.endTime).toISOString().slice(0, 10);
            dateCounts[dateKey] = (dateCounts[dateKey] ?? 0) + 1;
            if (!lastReadDate || dateKey > lastReadDate) {
              lastReadDate = dateKey;
            }
          }
        }

        const uniqueDates = Object.keys(dateCounts);
        const { currentStreak, longestStreak } = computeStreaks(uniqueDates);

        return {
          totalReadingMs,
          totalListeningMs,
          booksStarted: startedBookIds.size,
          booksCompleted: state.completedBooks.size,
          sessionsByDate: dateCounts,
          currentStreak,
          longestStreak,
          lastReadDate,
        };
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      // Set is not JSON-serializable — store as array
      partialize: (state) => ({
        sessions: state.sessions,
        completedBooks: [...state.completedBooks],
      }),
      merge: (persisted: unknown, current) => {
        const raw = persisted as {
          sessions?: ReadingSession[];
          completedBooks?: string[];
        };
        return {
          ...current,
          sessions: raw?.sessions ?? [],
          completedBooks: new Set(raw?.completedBooks ?? []),
        };
      },
    },
  ),
);
