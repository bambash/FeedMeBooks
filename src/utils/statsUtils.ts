import type { Book } from '../types';

export interface LibraryStats {
  booksReadThisMonth: number;
  hoursListened: number;
  currentStreak: number;
  readingPace: number; // pages or percentage per day
  totalBooks: number;
  inProgress: number;
  completed: number;
}

export function computeStats(books: Book[]): LibraryStats {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const oneDayMs = 86400000;

  // Books read this month: books with lastOpenedAt in this month
  const booksReadThisMonth = books.filter(
    (b) => b.session.lastOpenedAt >= startOfMonth,
  ).length;

  // Hours listened: sum of audioFileDurations for each book's current position
  let totalAudioSeconds = 0;
  for (const book of books) {
    if (book.session.lastMode === 'audio' || book.audioUris?.length) {
      const durations = book.session.audioFileDurations ?? [];
      for (let i = 0; i < book.session.audioFileIndex; i++) {
        totalAudioSeconds += durations[i] ?? 0;
      }
      totalAudioSeconds += book.session.audioPosition;
    }
  }
  const hoursListened = Math.round(totalAudioSeconds / 3600);

  // Current streak: consecutive days (including today) with at least one book opened
  const openedDays = new Set<number>();
  const msPerDay = 86400000;
  for (const book of books) {
    const day = Math.floor(book.session.lastOpenedAt / msPerDay);
    openedDays.add(day);
  }

  const todayDay = Math.floor(Date.now() / msPerDay);
  let streak = 0;
  for (let d = todayDay; d >= 0; d--) {
    if (openedDays.has(d)) {
      streak++;
    } else {
      break;
    }
  }

  // Reading pace: average percentage progress per day across all books
  // Simplified: books with progress > 0 and < 100
  const inProgress = books.filter((b) => {
    const pct = b.session.ebookPosition.percentage;
    return pct > 0 && pct < 1;
  }).length;

  const completed = books.filter(
    (b) => b.session.ebookPosition.percentage >= 1,
  ).length;

  const readingPace = books.length > 0
    ? Math.round(
        books.reduce((sum, b) => sum + b.session.ebookPosition.percentage * 100, 0) /
          books.length,
      )
    : 0;

  return {
    booksReadThisMonth,
    hoursListened,
    currentStreak: streak,
    readingPace,
    totalBooks: books.length,
    inProgress,
    completed,
  };
}
