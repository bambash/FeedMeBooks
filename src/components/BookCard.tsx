import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import type { Book } from '../types';

interface Props {
  book: Book;
  onLongPress: (book: Book) => void;
}

export default function BookCard({ book, onLongPress }: Props) {
  const router = useRouter();

  const handlePress = useCallback(() => {
    router.push(`/reader/${book.id}`);
  }, [book.id, router]);

  const handleLongPress = useCallback(() => {
    onLongPress(book);
  }, [book, onLongPress]);

  const progressPercent = Math.round(
    (book.session.lastMode === 'audio'
      ? 0 // audio progress shown differently
      : book.session.ebookPosition.percentage) * 100,
  );

  const hasEbook = Boolean(book.ebookUri);
  const hasAudio = Boolean(book.audioUri);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={handlePress}
      onLongPress={handleLongPress}
    >
      {/* Cover */}
      <View style={styles.cover}>
        {book.coverUri ? (
          <Image
            source={{ uri: book.coverUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : (
          <CoverPlaceholder title={book.title} />
        )}
        {/* Format badges */}
        <View style={styles.badges}>
          {hasEbook && <Badge label={book.ebookFormat?.toUpperCase() ?? '📖'} />}
          {hasAudio && <Badge label="🎧" />}
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{book.title}</Text>
        {book.author ? (
          <Text style={styles.author} numberOfLines={1}>{book.author}</Text>
        ) : null}

        {/* Progress */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Text style={styles.progressLabel}>{progressPercent}%</Text>
      </View>
    </Pressable>
  );
}

function CoverPlaceholder({ title }: { title: string }) {
  const letter = title.trim()[0]?.toUpperCase() ?? '?';
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderLetter}>{letter}</Text>
    </View>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },
  cover: {
    width: '100%',
    aspectRatio: 0.68,
    backgroundColor: colors.surfaceHigh,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDim,
  },
  placeholderLetter: {
    fontSize: 52,
    fontWeight: '700',
    color: colors.primaryLight,
    opacity: 0.8,
  },
  badges: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    gap: spacing.xs,
  },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginBottom: 2,
  },
  badgeText: {
    ...typography.tiny,
    color: colors.white,
  },
  info: {
    padding: spacing.sm,
  },
  title: {
    ...typography.small,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  author: {
    ...typography.tiny,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressLabel: {
    ...typography.tiny,
    color: colors.textMuted,
    marginTop: 3,
  },
});
