import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Book, BookSession, EbookPosition, ReaderMode } from '../types';

const STORAGE_KEY = 'feedmebooks-library';

interface LibraryState {
  books: Book[];
  addBook: (book: Omit<Book, 'session' | 'addedAt'>) => void;
  updateBook: (id: string, updates: Partial<Omit<Book, 'id'>>) => void;
  removeBook: (id: string) => void;
  updateSession: (id: string, session: Partial<BookSession>) => void;
  updateEbookPosition: (id: string, position: Partial<EbookPosition>) => void;
  updateAudioPosition: (id: string, fileIndex: number, positionSeconds: number) => void;
  updateAudioFileDuration: (id: string, fileIndex: number, durationSeconds: number) => void;
  setLastMode: (id: string, mode: ReaderMode) => void;
  getBook: (id: string) => Book | undefined;
}

const defaultSession = (): BookSession => ({
  ebookPosition: { percentage: 0 },
  audioPosition: 0,
  audioFileIndex: 0,
  audioFileDurations: [],
  lastMode: 'ebook',
  lastOpenedAt: Date.now(),
});

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      books: [],

      addBook: (bookData) => {
        const book: Book = {
          ...bookData,
          session: defaultSession(),
          addedAt: Date.now(),
        };
        set((state) => ({ books: [...state.books, book] }));
      },

      updateBook: (id, updates) => {
        set((state) => ({
          books: state.books.map((b) => (b.id === id ? { ...b, ...updates } : b)),
        }));
      },

      removeBook: (id) => {
        set((state) => ({ books: state.books.filter((b) => b.id !== id) }));
      },

      updateSession: (id, sessionUpdates) => {
        set((state) => ({
          books: state.books.map((b) =>
            b.id === id ? { ...b, session: { ...b.session, ...sessionUpdates } } : b,
          ),
        }));
      },

      updateEbookPosition: (id, position) => {
        set((state) => ({
          books: state.books.map((b) =>
            b.id === id
              ? {
                  ...b,
                  session: {
                    ...b.session,
                    ebookPosition: { ...b.session.ebookPosition, ...position },
                  },
                }
              : b,
          ),
        }));
      },

      updateAudioPosition: (id, fileIndex, positionSeconds) => {
        set((state) => ({
          books: state.books.map((b) =>
            b.id === id
              ? { ...b, session: { ...b.session, audioFileIndex: fileIndex, audioPosition: positionSeconds } }
              : b,
          ),
        }));
      },

      updateAudioFileDuration: (id, fileIndex, durationSeconds) => {
        set((state) => ({
          books: state.books.map((b) => {
            if (b.id !== id) return b;
            const durations = [...(b.session.audioFileDurations ?? [])];
            durations[fileIndex] = durationSeconds;
            return { ...b, session: { ...b.session, audioFileDurations: durations } };
          }),
        }));
      },

      setLastMode: (id, mode) => {
        set((state) => ({
          books: state.books.map((b) =>
            b.id === id
              ? {
                  ...b,
                  session: {
                    ...b.session,
                    lastMode: mode,
                    lastOpenedAt: Date.now(),
                  },
                }
              : b,
          ),
        }));
      },

      getBook: (id) => get().books.find((b) => b.id === id),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
