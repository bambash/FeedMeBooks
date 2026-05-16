import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AddBookModal from '../src/components/AddBookModal';
import BookCard from '../src/components/BookCard';
import SearchBar from '../src/components/SearchBar';
import StatsCard from '../src/components/StatsCard';
import { useLibraryStore } from '../src/store/libraryStore';
import { colors, radius, spacing, typography } from '../src/theme';
import { computeStats } from '../src/utils/statsUtils';
import { deleteBookFiles } from '../src/utils/fileUtils';
import type { Book } from '../src/types';

type SortOption = 'recent' | 'title' | 'author' | 'progress' | 'added';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'progress', label: 'Progress' },
  { key: 'added', label: 'Added' },
];

export default function LibraryScreen() {
  const { books, removeBook } = useLibraryStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('recent');
  const insets = useSafeAreaInsets();

  const stats = useMemo(() => computeStats(books), [books]);

  const handleLongPress = useCallback(
    (book: Book) => {
      Alert.alert(
        book.title,
        'What would you like to do?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Delete Book',
                `Remove "${book.title}" from your library? The app's copies of the files will be deleted, but your original files are not affected.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      await deleteBookFiles(book.id);
                      removeBook(book.id);
                    },
                  },
                ],
              );
            },
          },
        ],
      );
    },
    [removeBook],
  );

  // Filter + sort
  const filteredBooks = useMemo(() => {
    let result = [...books];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q),
      );
    }

    switch (sort) {
      case 'title':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'author':
        result.sort((a, b) => a.author.localeCompare(b.author));
        break;
      case 'progress':
        result.sort(
          (a, b) => b.session.ebookPosition.percentage - a.session.ebookPosition.percentage,
        );
        break;
      case 'added':
        result.sort((a, b) => b.addedAt - a.addedAt);
        break;
      case 'recent':
      default:
        result.sort((a, b) => b.session.lastOpenedAt - a.session.lastOpenedAt);
        break;
    }

    return result;
  }, [books, search, sort]);

  const inProgressBooks = useMemo(
    () =>
      filteredBooks.filter((b) => {
        const p = b.session.ebookPosition.percentage;
        return p > 0 && p < 1;
      }),
    [filteredBooks],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>FeedMeBooks</Text>
          <Text style={styles.subtitle}>
            {books.length === 0
              ? 'Your library is empty'
              : `${books.length} book${books.length !== 1 ? 's' : ''}`}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            onPress={() => setShowAddModal(true)}
          >
            <Text style={styles.addBtnText}>+ Add</Text>
          </Pressable>
        </View>
      </View>

      {books.length === 0 ? (
        <EmptyState onAdd={() => setShowAddModal(true)} />
      ) : (
        <FlatList
          data={filteredBooks}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
          columnWrapperStyle={styles.row}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {/* Stats Row */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.statsScroll}
              >
                <StatsCard icon="📚" label="Books" value={stats.totalBooks} />
                <StatsCard
                  icon="🔥"
                  label="Streak"
                  value={`${stats.currentStreak}d`}
                  color={colors.accent}
                />
                <StatsCard
                  icon="🎧"
                  label="Listened"
                  value={`${stats.hoursListened}h`}
                  color={colors.success}
                />
                <StatsCard
                  icon="📊"
                  label="Pace"
                  value={`${stats.readingPace}%`}
                  color={colors.primaryLight}
                />
              </ScrollView>

              {/* Search + Sort */}
              <View style={styles.controls}>
                <SearchBar value={search} onChangeText={setSearch} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.sortScroll}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.key}
                      style={[
                        styles.sortChip,
                        sort === opt.key && styles.sortChipActive,
                      ]}
                      onPress={() => setSort(opt.key)}
                    >
                      <Text
                        style={[
                          styles.sortChipText,
                          sort === opt.key && styles.sortChipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* Continue Reading */}
              {inProgressBooks.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Continue Reading</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.continueScroll}
                  >
                    {inProgressBooks.map((book) => (
                      <View key={book.id} style={styles.continueCard}>
                        <BookCard book={book} onLongPress={handleLongPress} />
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {filteredBooks.length > 0 && (
                <Text style={styles.sectionTitle}>
                  {search ? 'Search Results' : 'Library'}
                  {search ? ` (${filteredBooks.length})` : ''}
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <BookCard book={item} onLongPress={handleLongPress} />
          )}
          ListEmptyComponent={
            search ? (
              <View style={styles.emptySearch}>
                <Text style={styles.emptySearchIcon}>🔍</Text>
                <Text style={styles.emptySearchText}>
                  No books matching "{search}"
                </Text>
              </View>
            ) : null
          }
        />
      )}

      <AddBookModal visible={showAddModal} onClose={() => setShowAddModal(false)} />
    </View>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>📚</Text>
      <Text style={styles.emptyTitle}>No books yet</Text>
      <Text style={styles.emptyBody}>
        Add your first book by tapping the button above.{'\n'}
        Supports epub, pdf, txt and mp3, m4b, wav and more.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.8 }]}
        onPress={onAdd}
      >
        <Text style={styles.emptyBtnText}>Add Your First Book</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  appName: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  addBtnText: {
    ...typography.small,
    color: colors.white,
    fontWeight: '700',
  },
  // List header
  listHeader: {
    paddingTop: spacing.sm,
  },
  // Stats
  statsScroll: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  // Controls
  controls: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sortScroll: {
    gap: spacing.xs,
  },
  sortChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipActive: {
    backgroundColor: colors.primaryDim,
    borderColor: colors.primary,
  },
  sortChipText: {
    ...typography.small,
    color: colors.textMuted,
    fontWeight: '600',
  },
  sortChipTextActive: {
    color: colors.primaryLight,
  },
  // Continue Reading
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  continueScroll: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  continueCard: {
    width: 160,
  },
  // Grid
  grid: {
    padding: spacing.md,
    gap: spacing.md,
  },
  row: {
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  // Empty
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 72,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  emptyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  emptyBtnText: {
    ...typography.body,
    color: colors.white,
    fontWeight: '700',
  },
  emptySearch: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  emptySearchIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptySearchText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
