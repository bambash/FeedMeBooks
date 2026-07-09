export type EbookFormat = 'epub' | 'pdf' | 'txt';
export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'm4b' | 'mp4' | 'aac' | 'ogg' | 'flac' | 'opus';
export type ReaderMode = 'ebook' | 'audio';

export const SUPPORTED_EBOOK_EXTENSIONS: EbookFormat[] = ['epub', 'pdf', 'txt'];
export const SUPPORTED_AUDIO_EXTENSIONS: AudioFormat[] = ['mp3', 'wav', 'm4a', 'm4b', 'mp4', 'aac', 'ogg', 'flac', 'opus'];

export const EBOOK_MIME_TYPES = [
  'application/epub+zip',
  'application/pdf',
  'text/plain',
];

export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'video/mp4',
  'audio/x-m4a',
  'audio/m4b',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/opus',
  'audio/*',
];

export interface EbookPosition {
  /** epub CFI string */
  cfi?: string;
  /** PDF page number (1-indexed) */
  page?: number;
  /** Plain text scroll offset in pixels */
  scrollY?: number;
  /** 0–1 fractional progress */
  percentage: number;
  /** Spine item index of the currently displayed epub chapter (-1 if unknown) */
  spineIndex?: number;
}

export interface BookSession {
  ebookPosition: EbookPosition;
  audioPosition: number; // seconds within the current audio file
  audioFileIndex: number; // index into book.audioUris
  /** Cached duration (seconds) of each audio file, populated as tracks are played */
  audioFileDurations: number[];
  lastMode: ReaderMode;
  lastOpenedAt: number; // unix ms
  /** Unix ms when the word-level position index was built; undefined = not yet built */
  positionMapCreatedAt?: number;
}

export interface ChapterAnchor {
  /** epub.js spine index (0-based) this anchor is within */
  chapterIndex: number;
  /** Canonical key component. Boundary anchors use 0 for chapter-boundary anchors;
   *  only confirmed interior anchors carry a real measured fraction.
   *  chapterIndex + withinChapterFraction is the anchor's canonical key, the single
   *  sort/lookup axis.
   */
  withinChapterFraction: number;
  /** Milliseconds from the start of the whole audiobook at this canonical position */
  audioMs: number;
  /** Alignment source for this anchor. */
  source: 'forced-alignment' | 'proportional-fallback' | 'confirmed';
  /** Word-overlap match score (0-1); present only when source === 'forced-alignment'. */
  confidence?: number;
}

export interface ChapterPosition {
  chapterIndex: number;
  /** 0-1 position within this chapter's interpolation segment. One definition shared
   *  by both sync directions.
   */
  withinChapterFraction: number;
}

export interface AudiobookPositionMap {
  bookId: string;
  createdAt: number;
  totalAudioMs: number;
  /** Sorted ascending by canonical key (equivalently by audioMs). Invariant: one
   *  boundary entry per content chapter at construction, plus at most one interior
   *  confirmed entry per chapter. chapterIndex is not unique; never look up by it alone.
   */
  chapterAnchors: ChapterAnchor[];
  /** 'unavailable' when no chapter resolved as forced-alignment. */
  builtFrom: 'transcript' | 'unavailable';
}

export interface Book {
  id: string;
  title: string;
  author: string;
  ebookUri?: string;
  ebookFormat?: EbookFormat;
  audioUris?: string[]; // ordered list; single-file books have length 1
  audioFormat?: AudioFormat;
  coverUri?: string;
  session: BookSession;
  addedAt: number; // unix ms
}

export interface ReadingSession {
  id: string;
  bookId: string;
  startTime: number; // unix ms
  endTime?: number; // unix ms
  durationMs?: number;
  mode: 'ebook' | 'audio';
  chapterStart: number; // spine index or -1
  chapterEnd?: number;
}

export interface UserStats {
  totalReadingMs: number;
  totalListeningMs: number;
  booksStarted: number;
  booksCompleted: number;
  sessionsByDate: Record<string, number>; // "YYYY-MM-DD" → session count
  currentStreak: number;
  longestStreak: number;
  lastReadDate?: string; // "YYYY-MM-DD"
}

export interface BookStats {
  bookId: string;
  totalReadingMs: number;
  totalListeningMs: number;
  sessions: number;
  lastPosition: number; // 0-1 percentage
  completed: boolean;
}
