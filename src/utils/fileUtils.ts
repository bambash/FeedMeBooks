import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Alert, Platform } from 'react-native';
import type { AudioFormat, EbookFormat } from '../types';
import {
  AUDIO_MIME_TYPES,
  EBOOK_MIME_TYPES,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_EBOOK_EXTENSIONS,
} from '../types';

const BOOKS_DIR = FileSystem.documentDirectory + 'books/';

export async function ensureBooksDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(BOOKS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(BOOKS_DIR, { intermediates: true });
  }
}

/** Copy a picked file into the app's document directory and return the local URI. */
export async function copyFileToAppStorage(
  sourceUri: string,
  bookId: string,
  filename: string,
): Promise<string> {
  await ensureBooksDir();
  const bookDir = BOOKS_DIR + bookId + '/';
  const dirInfo = await FileSystem.getInfoAsync(bookDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(bookDir, { intermediates: true });
  }
  const destUri = bookDir + filename;
  await FileSystem.copyAsync({ from: sourceUri, to: destUri });
  return destUri;
}

/** Delete all files associated with a book. */
export async function deleteBookFiles(bookId: string): Promise<void> {
  const bookDir = BOOKS_DIR + bookId + '/';
  const info = await FileSystem.getInfoAsync(bookDir);
  if (info.exists) {
    await FileSystem.deleteAsync(bookDir, { idempotent: true });
  }
}

export function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts[parts.length - 1].toLowerCase();
}

export function isEbookExtension(ext: string): ext is EbookFormat {
  return (SUPPORTED_EBOOK_EXTENSIONS as string[]).includes(ext);
}

export function isAudioExtension(ext: string): ext is AudioFormat {
  return (SUPPORTED_AUDIO_EXTENSIONS as string[]).includes(ext);
}

export async function pickEbookFile(): Promise<DocumentPicker.DocumentPickerResult> {
  return DocumentPicker.getDocumentAsync({
    type: EBOOK_MIME_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
}

export async function pickAudioFile(): Promise<DocumentPicker.DocumentPickerResult> {
  return DocumentPicker.getDocumentAsync({
    type: AUDIO_MIME_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
}

export async function pickCoverImage(): Promise<DocumentPicker.DocumentPickerResult> {
  return DocumentPicker.getDocumentAsync({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    copyToCacheDirectory: true,
    multiple: false,
  });
}

/** Format seconds as hh:mm:ss or mm:ss. */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** Read a file and return a base64-encoded string. */
export async function readFileAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
