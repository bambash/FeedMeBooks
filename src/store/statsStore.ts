import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ReaderMode } from '../types';
import { DEFAULT_STATS, type ReadingSession, type UserStats } from '../types/stats';

const STORAGE_KEY = 'feedmebooks-stats';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface StatsState {
  sessions: ReadingSession[];
  stats: UserStats;

  startSession: (
    bookId: string,
    mode: ReaderMode,
    startPosition: number,
  ) => string;

  endSession: (
    sessionId: string,
    endPosition: number,
    mode: ReaderMode,
    /** Current page for PDF; undefined otherwise */
    currentPage?: number,
    /** Start page for PDF; undefined otherwise */
    startPage?: number,
  ) => void;

  getSessionsForBook: (bookId: string) => ReadingSession[];
  recalculateStats: () => void;
}

export const useStatsStore = create<StatsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      stats: { ...DEFAULT_STATS },

      startSession: (bookId, mode, startPosition) => {
        const id = uuid();
        const session: ReadingSession = {
          id,
          bookId,
          startTime: Date.now(),
          mode,
          startPosition,
        };
        set((state) => ({ sessions: [...state.sessions, session] }));
        return id;
      },

      endSession: (sessionId, endPosition, mode, currentPage, startPage) => {
        set((state) => {
          const now = Date.now();
          const sessions = state.sessions.map((s) => {
            if (s.id !== sessionId) return s;
            const durationMs = now - s.startTime;
            let pagesRead: number | undefined;
            if (
              currentPage != null &&
              startPage != null &&
              currentPage > startPage
            ) {
              pagesRead = currentPage - startPage;
            }
            return {
              ...s,
              endTime: now,
              endPosition,
              mode,
              durationMs,
              pagesRead,
            };
          });
          return { sessions };
        });
        get().recalculateStats();
      },

      getSessionsForBook: (bookId) => {
        return get().sessions.filter((s) => s.bookId === bookId);
      },

      recalculateStats: () => {
        const { sessions } = get();
        const completed = sessions.filter((s) => s.endTime != null);
        const totalReadingTimeMs = completed.reduce(
          (sum, s) => sum + (s.durationMs ?? 0),
          0,
        );
        const totalPagesRead = completed.reduce(
          (sum, s) => sum + (s.pagesRead ?? 0),
          0,
        );
        const totalAudioMinutes = completed
          .filter((s) => s.mode === 'audio')
          .reduce((sum, s) => sum + ((s.durationMs ?? 0) / 60000), 0);

        const bookIds = new Set(completed.map((s) => s.bookId));
        const totalBooksRead = bookIds.size;

        // Books completed: books where last session ended with position >= 0.95
        const booksCompleted = new Set<string>();
        for (const bookId of bookIds) {
          const bookSessions = completed
            .filter((s) => s.bookId === bookId)
            .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
          if (
            bookSessions.length > 0 &&
            (bookSessions[0].endPosition ?? 0) >= 0.95
          ) {
            booksCompleted.add(bookId);
          }
        }

        // Daily minutes
        const dailyMinutes: Record<string, number> = {};
        for (const s of completed) {
          const dk = dateKey(s.startTime);
          const mins = (s.durationMs ?? 0) / 60000;
          dailyMinutes[dk] = (dailyMinutes[dk] ?? 0) + mins;
        }

        // Streaks
        const activeDates = Object.keys(dailyMinutes).sort().reverse();
        const today = dateKey(Date.now());
        const yesterday = dateKey(Date.now() - 86400000);

        let currentStreak = 0;
        const lastReadDate = activeDates.length > 0 ? activeDates[0] : null;
        if (lastReadDate != null) {
          const startRef =
            lastReadDate === today || lastReadDate === yesterday
              ? lastReadDate
              : null;
          if (startRef != null) {
            // Count consecutive days backwards from startRef
            const startDate = new Date(startRef + 'T00:00:00Z');
            for (let i = 0; ; i++) {
              const d = new Date(startDate.getTime() - i * 86400000);
              const dk = d.toISOString().slice(0, 10);
              if ((dailyMinutes[dk] ?? 0) > 0) {
                currentStreak++;
              } else {
                break;
              }
            }
          }
        }

        // Longest streak
        let longestStreak = 0;
        const sortedDates = Object.keys(dailyMinutes)
          .filter((d) => (dailyMinutes[d] ?? 0) > 0)
          .sort();
        if (sortedDates.length > 0) {
          let run = 1;
          longestStreak = 1;
          for (let i = 1; i < sortedDates.length; i++) {
            const prev = new Date(sortedDates[i - 1] + 'T00:00:00Z');
            const curr = new Date(sortedDates[i] + 'T00:00:00Z');
            if ((curr.getTime() - prev.getTime()) / 86400000 === 1) {
              run++;
              longestStreak = Math.max(longestStreak, run);
            } else {
              run = 1;
            }
          }
        }

        const stats: UserStats = {
          totalReadingTimeMs,
          totalBooksRead,
          totalBooksCompleted: booksCompleted.size,
          currentStreak,
          longestStreak,
          lastReadDate,
          dailyMinutes,
          totalPagesRead,
          totalAudioMinutes,
        };

        set({ stats });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
