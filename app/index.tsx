import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AddBookModal from '../src/components/AddBookModal';
import BookCard from '../src/components/BookCard';
import { useLibraryStore } from '../src/store/libraryStore';
import { colors, radius, spacing, typography } from '../src/theme';
import { deleteBookFiles } from '../src/utils/fileUtils';
import type { Book } from '../src/types';

export default function LibraryScreen() {
  const { books, removeBook } = useLibraryStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const insets = useSafeAreaInsets();

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
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
          onPress={() => setShowAddModal(true)}
        >
          <Text style={styles.addBtnText}>+ Add Book</Text>
        </Pressable>
      </View>

      {/* Book grid */}
      {books.length === 0 ? (
        <EmptyState onAdd={() => setShowAddModal(true)} />
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => (
            <BookCard book={item} onLongPress={handleLongPress} />
          )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appName: {
    ...typography.h2,
    color: colors.text,
  },
  subtitle: {
    ...typography.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addBtnText: {
    ...typography.small,
    color: colors.white,
    fontWeight: '700',
  },
  grid: {
    padding: spacing.md,
    gap: spacing.md,
  },
  row: {
    justifyContent: 'space-between',
    gap: spacing.md,
  },
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
});
