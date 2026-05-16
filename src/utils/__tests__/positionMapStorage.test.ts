import AsyncStorage from '@react-native-async-storage/async-storage';
import { savePositionMap, loadPositionMap, deletePositionMap } from '../positionMapStorage';
import type { PositionMap } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

const MOCK_MAP: PositionMap = {
  bookId: 'book-abc',
  createdAt: 1_700_000_000_000,
  totalAudioMs: 3_600_000,
  anchors: [
    { audioMs: 0, chapterIndex: 0, fileIndex: 0, fileSeconds: 0, withinChapterFraction: 0, source: 'proportional' as const },
    { audioMs: 30_000, chapterIndex: 1, fileIndex: 0, fileSeconds: 0, withinChapterFraction: 0, source: 'proportional' as const },
    { audioMs: 60_000, chapterIndex: 2, fileIndex: 0, fileSeconds: 0, withinChapterFraction: 0, source: 'proportional' as const },
  ],
};

const STORAGE_KEY = 'feedmebooks:positionmap:book-abc';

beforeEach(() => jest.clearAllMocks());

describe('savePositionMap', () => {
  it('writes JSON to the correct key', async () => {
    await savePositionMap(MOCK_MAP);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify(MOCK_MAP),
    );
  });
});

describe('loadPositionMap', () => {
  it('returns parsed map when key exists', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify(MOCK_MAP),
    );
    const result = await loadPositionMap('book-abc');
    expect(result).toEqual(MOCK_MAP);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('returns null when key does not exist', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
    expect(await loadPositionMap('book-abc')).toBeNull();
  });

  it('returns null when stored value is malformed JSON', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('{invalid json');
    expect(await loadPositionMap('book-abc')).toBeNull();
  });
});

describe('deletePositionMap', () => {
  it('removes the correct key', async () => {
    await deletePositionMap('book-abc');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });
});
