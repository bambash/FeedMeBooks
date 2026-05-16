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

/** A single anchor point in the audio↔ebook position map */
export interface PositionAnchor {
  /** Milliseconds from the start of the whole audiobook */
  audioMs: number;
  /** Index into book.audioUris[] */
  fileIndex: number;
  /** Seconds within that file */
  fileSeconds: number;
  /** epub.js spine chapter index (0-based) */
  chapterIndex: number;
  /** 0–1 position within the chapter (reserved for future fine-grained sync) */
  withinChapterFraction: number;
  /** How this anchor was derived */
  source: 'proportional' | 'transcript';
}

/** Position map for an audiobook+ebook pair, stored separately in AsyncStorage */
export interface PositionMap {
  bookId: string;
  createdAt: number; // unix ms
  totalAudioMs: number;
  /** Sorted ascending by audioMs */
  anchors: PositionAnchor[];
}

/** @deprecated Use PositionAnchor instead */
export interface SyncPoint {
  /** Milliseconds from the start of the whole audiobook */
  audioMs: number;
  /** Index into book.audioUris[] */
  fileIndex: number;
  /** Seconds within that file */
  fileSeconds: number;
  /** epub.js spine chapter index (0-based) */
  chapterIndex: number;
  /** 0–1 position within the chapter (reserved for future fine-grained sync) */
  withinChapterFraction: number;
}

/** @deprecated Use PositionMap instead */
export interface SyncMap {
  bookId: string;
  createdAt: number; // unix ms
  totalAudioMs: number;
  /** Sorted ascending by audioMs */
  points: SyncPoint[];
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
