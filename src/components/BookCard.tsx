import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { formatRelativeTime } from '../utils/timeUtils';
import type { Book } from '../types';

interface Props {
  book: Book;
  onLongPress: (book: Book) => void;
}

export default function BookCard({ book, onLongPress }: Props) {
  const router = useRouter();

  const handlePress = useCallback(() => {
    Vibration.vibrate(10);
    router.push(`/reader/${book.id}`);
  }, [book.id, router]);

  const handleLongPress = useCallback(() => {
    onLongPress(book);
  }, [book, onLongPress]);

  const progress = book.session.ebookPosition.percentage;
  const hasEbook = Boolean(book.ebookUri);
  const hasAudio = Boolean(book.audioUris?.length);
  const status: 'unread' | 'reading' | 'finished' =
    progress === 0 ? 'unread' : progress >= 1 ? 'finished' : 'reading';

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

        {/* Status badge */}
        <View style={[styles.statusBadge, statusColors[status]]}>
          <Text style={styles.statusText}>{statusLabels[status]}</Text>
        </View>

        {/* Format badges */}
        <View style={styles.badges}>
          {hasEbook && <Badge label={book.ebookFormat?.toUpperCase() ?? '📖'} />}
          {hasAudio && <Badge label="🎧" />}
        </View>

        {/* Progress ring */}
        {status === 'reading' && (
          <View style={styles.progressRingWrap}>
            <CircularProgress
              progress={progress}
              size={32}
              strokeWidth={3}
              color={colors.primary}
            />
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        {book.author ? (
          <Text style={styles.author} numberOfLines={1}>
            {book.author}
          </Text>
        ) : null}
        <Text style={styles.lastOpened}>
          {formatRelativeTime(book.session.lastOpenedAt)}
        </Text>
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

/** Pure-RN circular progress ring using half-circle clipping with filled sectors */
function CircularProgress({
  progress,
  size,
  strokeWidth,
  color,
}: {
  progress: number; // 0–1
  size: number;
  strokeWidth: number;
  color: string;
}) {
  const r = size / 2;
  const innerSize = size - strokeWidth * 2;
  const innerR = innerSize / 2;
  const degrees = Math.min(progress, 1) * 360;

  // Right half-clip shows 0–180°, left half-clip shows 180–360°
  const rightDeg = Math.min(degrees, 180);
  const leftDeg = Math.max(0, degrees - 180);

  return (
    <View style={{ width: size, height: size }}>
      {/* Track ring */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: r,
          borderWidth: strokeWidth,
          borderColor: 'rgba(255,255,255,0.15)',
        }}
      />

      {/* Right half (0–180°): container clips left side, filled circle inside rotates CCW from top */}
      <View style={{ position: 'absolute', top: 0, left: r, width: r, height: size, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: -r,
            width: size,
            height: size,
            borderRadius: r,
            backgroundColor: color,
            transform: [{ rotate: `${rightDeg}deg` }],
          }}
        />
      </View>

      {/* Left half (180–360°): only visible when progress > 50% */}
      {leftDeg > 0 && (
        <View style={{ position: 'absolute', top: 0, left: 0, width: r, height: size, overflow: 'hidden' }}>
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: size,
              height: size,
              borderRadius: r,
              backgroundColor: color,
              transform: [{ rotate: `${leftDeg}deg` }],
            }}
          />
        </View>
      )}

      {/* Inner circle — knocks out the center to create the ring effect */}
      <View
        style={{
          position: 'absolute',
          top: strokeWidth,
          left: strokeWidth,
          width: innerSize,
          height: innerSize,
          borderRadius: innerR,
          backgroundColor: 'rgba(0,0,0,0.55)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={styles.pgText}>{Math.round(progress * 100)}</Text>
      </View>
    </View>
  );
}

const statusColors = {
  unread: { backgroundColor: colors.surfaceHigh + 'E6' },
  reading: { backgroundColor: colors.primary + 'E6' },
  finished: { backgroundColor: colors.success + 'E6' },
} as const;

const statusLabels = {
  unread: 'New',
  reading: 'Reading',
  finished: 'Done',
} as const;

const styles = StyleSheet.create({
  card: {
    width: '47%',
    backgroundColor: colors.surface + 'CC',
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border + '80',
  },
  cardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  cover: {
    width: '100%',
    aspectRatio: 0.72,
    backgroundColor: colors.surfaceHigh,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDim,
  },
  placeholderLetter: {
    fontSize: 48,
    fontWeight: '800',
    color: colors.primaryLight,
    opacity: 0.7,
  },
  statusBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  statusText: {
    ...typography.tiny,
    color: colors.white,
    fontWeight: '700',
  },
  badges: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    gap: spacing.xs,
  },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginBottom: 2,
  },
  badgeText: {
    ...typography.tiny,
    color: colors.white,
  },
  progressRingWrap: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
  },
  pgText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.white,
  },
  info: {
    padding: spacing.sm,
    gap: 2,
  },
  title: {
    ...typography.small,
    color: colors.text,
    fontWeight: '700',
  },
  author: {
    ...typography.tiny,
    color: colors.textMuted,
  },
  lastOpened: {
    ...typography.tiny,
    color: colors.textFaint,
    marginTop: spacing.xs,
  },
});
