jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

import { useStatsStore } from '../statsStore';

function resetStore() {
  useStatsStore.setState({ sessions: [], completedBooks: new Set() });
}

/** Advance the mocked clock between start and end so durationMs > 0 */
function startAndEnd(
  bookId: string,
  mode: 'ebook' | 'audio',
  chapterStart: number,
  chapterEnd?: number,
): void {
  const store = useStatsStore.getState();
  const id = store.startSession(bookId, mode, chapterStart);
  jest.advanceTimersByTime(60_000);
  store.endSession(id, chapterEnd);
}

describe('statsStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-16T12:00:00Z'));
    resetStore();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startSession / endSession', () => {
    it('creates a session with start time and mode', () => {
      const id = useStatsStore.getState().startSession('book-1', 'ebook', 3);
      const session = useStatsStore
        .getState()
        .sessions.find((s) => s.id === id);
      expect(session).toBeDefined();
      expect(session!.bookId).toBe('book-1');
      expect(session!.mode).toBe('ebook');
      expect(session!.chapterStart).toBe(3);
      expect(session!.startTime).toBeGreaterThan(0);
      expect(session!.endTime).toBeUndefined();
    });

    it('sets endTime and durationMs when session ends', () => {
      const store = useStatsStore.getState();
      const id = store.startSession('book-1', 'audio', 0);
      jest.advanceTimersByTime(30_000);
      store.endSession(id, 5);

      const session = useStatsStore
        .getState()
        .sessions.find((s) => s.id === id);
      expect(session!.endTime).toBeDefined();
      expect(session!.durationMs).toBe(30_000);
      expect(session!.chapterEnd).toBe(5);
    });
  });

  describe('getBookStats', () => {
    it('computes per-book stats', () => {
      startAndEnd('book-1', 'ebook', 0);
      startAndEnd('book-1', 'ebook', 2);
      startAndEnd('book-2', 'audio', 0);

      const stats1 = useStatsStore.getState().getBookStats('book-1');
      expect(stats1.sessions).toBe(2);
      expect(stats1.totalReadingMs).toBe(120_000);
      expect(stats1.totalListeningMs).toBe(0);

      const stats2 = useStatsStore.getState().getBookStats('book-2');
      expect(stats2.sessions).toBe(1);
      expect(stats2.totalListeningMs).toBe(60_000);
      expect(stats2.totalReadingMs).toBe(0);
    });

    it('returns zeroes for unknown book', () => {
      const stats = useStatsStore.getState().getBookStats('nonexistent');
      expect(stats.sessions).toBe(0);
      expect(stats.totalReadingMs).toBe(0);
      expect(stats.totalListeningMs).toBe(0);
    });
  });

  describe('getGlobalStats', () => {
    it('computes global totals', () => {
      startAndEnd('book-a', 'ebook', 0);
      startAndEnd('book-b', 'audio', 0);

      const stats = useStatsStore.getState().getGlobalStats();
      expect(stats.booksStarted).toBe(2);
      expect(stats.totalReadingMs).toBe(60_000);
      expect(stats.totalListeningMs).toBe(60_000);
      expect(stats.lastReadDate).toBe('2026-05-16');
    });

    it('includes sessionsByDate keyed by date', () => {
      startAndEnd('book-1', 'ebook', 0);

      const stats = useStatsStore.getState().getGlobalStats();
      expect(stats.sessionsByDate['2026-05-16']).toBe(1);
    });

    it('computes current streak when read today', () => {
      startAndEnd('book-1', 'ebook', 0);

      const stats = useStatsStore.getState().getGlobalStats();
      expect(stats.currentStreak).toBe(1);
    });
  });

  describe('markBookCompleted', () => {
    it('marks a book as completed', () => {
      useStatsStore.getState().markBookCompleted('book-1');
      expect(
        useStatsStore.getState().completedBooks.has('book-1'),
      ).toBe(true);
    });

    it('is idempotent', () => {
      useStatsStore.getState().markBookCompleted('book-1');
      useStatsStore.getState().markBookCompleted('book-1');
      expect(useStatsStore.getState().completedBooks.size).toBe(1);
    });

    it('reflects in getGlobalStats', () => {
      useStatsStore.getState().markBookCompleted('book-1');
      const stats = useStatsStore.getState().getGlobalStats();
      expect(stats.booksCompleted).toBe(1);
    });

    it('reflects in getBookStats', () => {
      useStatsStore.getState().markBookCompleted('book-1');
      const stats = useStatsStore.getState().getBookStats('book-1');
      expect(stats.completed).toBe(true);
    });
  });
});
