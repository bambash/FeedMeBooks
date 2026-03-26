export type EbookFormat = 'epub' | 'pdf' | 'txt';
export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'm4b' | 'aac' | 'ogg' | 'flac' | 'opus';
export type ReaderMode = 'ebook' | 'audio';

export const SUPPORTED_EBOOK_EXTENSIONS: EbookFormat[] = ['epub', 'pdf', 'txt'];
export const SUPPORTED_AUDIO_EXTENSIONS: AudioFormat[] = ['mp3', 'wav', 'm4a', 'm4b', 'aac', 'ogg', 'flac', 'opus'];

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
}

export interface BookSession {
  ebookPosition: EbookPosition;
  audioPosition: number; // seconds within the current audio file
  audioFileIndex: number; // index into book.audioUris
  lastMode: ReaderMode;
  lastOpenedAt: number; // unix ms
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
