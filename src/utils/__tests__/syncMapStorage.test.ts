import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveSyncMap, loadSyncMap, deleteSyncMap } from '../syncMapStorage';
import type { SyncMap } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

const MOCK_MAP: SyncMap = {
  bookId: 'book-abc',
  createdAt: 1_700_000_000_000,
  totalAudioMs: 3_600_000,
  points: [
    { audioMs: 0, fileIndex: 0, fileSeconds: 0, chapterIndex: 0, withinChapterFraction: 0 },
    { audioMs: 30_000, fileIndex: 0, fileSeconds: 30, chapterIndex: 1, withinChapterFraction: 0 },
  ],
};

const STORAGE_KEY = 'feedmebooks:syncmap:book-abc';

beforeEach(() => jest.clearAllMocks());

describe('saveSyncMap', () => {
  it('writes JSON to the correct key', async () => {
    await saveSyncMap(MOCK_MAP);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify(MOCK_MAP),
    );
  });
});

describe('loadSyncMap', () => {
  it('returns parsed map when key exists', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify(MOCK_MAP),
    );
    const result = await loadSyncMap('book-abc');
    expect(result).toEqual(MOCK_MAP);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('returns null when key does not exist', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
    expect(await loadSyncMap('book-abc')).toBeNull();
  });

  it('returns null when stored value is malformed JSON', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('{invalid json');
    expect(await loadSyncMap('book-abc')).toBeNull();
  });
});

describe('deleteSyncMap', () => {
  it('removes the correct key', async () => {
    await deleteSyncMap('book-abc');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });
});
