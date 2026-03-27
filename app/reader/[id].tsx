import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AudioPlayer from '../../src/components/AudioPlayer';
import EbookReader from '../../src/components/EbookReader';
import { useLibraryStore } from '../../src/store/libraryStore';
import { colors, radius, spacing, typography } from '../../src/theme';
import type { EbookPosition, ReaderMode } from '../../src/types';

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { getBook, updateEbookPosition, updateAudioPosition, setLastMode } = useLibraryStore();
  const book = getBook(id);

  const [mode, setMode] = useState<ReaderMode>(book?.session.lastMode ?? 'ebook');
  const [showSettings, setShowSettings] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [fontSize, setFontSize] = useState(18);

  // Animate mode switch
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!book) {
      router.back();
    }
  }, [book, router]);

  useEffect(() => {
    if (book) setLastMode(book.id, mode);
  }, [mode]);

  const switchMode = useCallback(
    (next: ReaderMode) => {
      if (next === mode) return;
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setMode(next);
    },
    [mode, fadeAnim],
  );

  const handleEbookPositionChange = useCallback(
    (position: Partial<EbookPosition>) => {
      if (book) updateEbookPosition(book.id, position);
    },
    [book, updateEbookPosition],
  );

  const handleAudioPositionChange = useCallback(
    (fileIndex: number, seconds: number) => {
      if (book) updateAudioPosition(book.id, fileIndex, seconds);
    },
    [book, updateAudioPosition],
  );

  if (!book) return null;

  const canEbook = Boolean(book.ebookUri && book.ebookFormat);
  const canAudio = Boolean(book.audioUris?.length);
  const activeMode = mode === 'ebook' && canEbook ? 'ebook'
    : mode === 'audio' && canAudio ? 'audio'
    : canEbook ? 'ebook' : 'audio';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{book.title}</Text>
          {book.author ? (
            <Text style={styles.headerAuthor} numberOfLines={1}>{book.author}</Text>
          ) : null}
        </View>

        <Pressable onPress={() => setShowSettings((v) => !v)} style={styles.settingsBtn} hitSlop={12}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </Pressable>
      </View>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          darkMode={darkMode}
          fontSize={fontSize}
          onToggleDark={() => setDarkMode((v) => !v)}
          onFontSizeChange={setFontSize}
        />
      )}

      {/* Mode toggle tabs */}
      <View style={styles.modeTabs}>
        {canEbook && (
          <Pressable
            style={[styles.modeTab, activeMode === 'ebook' && styles.modeTabActive]}
            onPress={() => switchMode('ebook')}
          >
            <Text style={[styles.modeTabIcon, activeMode === 'ebook' && styles.modeTabIconActive]}>
              📖
            </Text>
            <Text style={[styles.modeTabLabel, activeMode === 'ebook' && styles.modeTabLabelActive]}>
              Read
            </Text>
          </Pressable>
        )}
        {canAudio && (
          <Pressable
            style={[styles.modeTab, activeMode === 'audio' && styles.modeTabActive]}
            onPress={() => switchMode('audio')}
          >
            <Text style={[styles.modeTabIcon, activeMode === 'audio' && styles.modeTabIconActive]}>
              🎧
            </Text>
            <Text style={[styles.modeTabLabel, activeMode === 'audio' && styles.modeTabLabelActive]}>
              Listen
            </Text>
          </Pressable>
        )}
      </View>

      {/* Content */}
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {activeMode === 'ebook' && canEbook ? (
          <>
            <EbookReader
              uri={book.ebookUri!}
              format={book.ebookFormat!}
              savedPosition={book.session.ebookPosition}
              onPositionChange={handleEbookPositionChange}
              darkMode={darkMode}
              fontSize={fontSize}
            />
            {/* Compact audio strip while reading — if audio exists */}
            {canAudio && (
              <AudioPlayer
                uris={book.audioUris!}
                fileIndex={book.session.audioFileIndex}
                savedPosition={book.session.audioPosition}
                onPositionChange={handleAudioPositionChange}
                bookTitle={book.title}
                compact
              />
            )}
          </>
        ) : activeMode === 'audio' && canAudio ? (
          <AudioPlayer
            uris={book.audioUris!}
            fileIndex={book.session.audioFileIndex}
            savedPosition={book.session.audioPosition}
            onPositionChange={handleAudioPositionChange}
            bookTitle={book.title}
          />
        ) : null}
      </Animated.View>

      {/* Bottom safe area */}
      <View style={{ height: insets.bottom }} />
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// Settings panel
// ────────────────────────────────────────────────────────────
function SettingsPanel({
  darkMode,
  fontSize,
  onToggleDark,
  onFontSizeChange,
}: {
  darkMode: boolean;
  fontSize: number;
  onToggleDark: () => void;
  onFontSizeChange: (size: number) => void;
}) {
  const MIN = 14;
  const MAX = 28;

  return (
    <View style={settingsStyles.panel}>
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.label}>Dark Mode</Text>
        <Pressable
          style={[settingsStyles.toggle, darkMode && settingsStyles.toggleOn]}
          onPress={onToggleDark}
        >
          <View style={[settingsStyles.thumb, darkMode && settingsStyles.thumbOn]} />
        </Pressable>
      </View>

      <View style={settingsStyles.row}>
        <Text style={settingsStyles.label}>Font Size</Text>
        <View style={settingsStyles.sizeRow}>
          <Pressable
            style={settingsStyles.sizeBtn}
            onPress={() => onFontSizeChange(Math.max(MIN, fontSize - 2))}
          >
            <Text style={settingsStyles.sizeBtnText}>A−</Text>
          </Pressable>
          <Text style={settingsStyles.sizeValue}>{fontSize}</Text>
          <Pressable
            style={settingsStyles.sizeBtn}
            onPress={() => onFontSizeChange(Math.min(MAX, fontSize + 2))}
          >
            <Text style={settingsStyles.sizeBtnText}>A+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const settingsStyles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.small,
    color: colors.text,
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleOn: {
    backgroundColor: colors.primary,
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.white,
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sizeBtn: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sizeBtnText: {
    ...typography.small,
    color: colors.text,
    fontWeight: '700',
  },
  sizeValue: {
    ...typography.small,
    color: colors.textMuted,
    minWidth: 24,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: {
    padding: spacing.xs,
    minWidth: 36,
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 28,
    color: colors.text,
    lineHeight: 32,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    ...typography.small,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerAuthor: {
    ...typography.tiny,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 1,
  },
  settingsBtn: {
    padding: spacing.xs,
    minWidth: 36,
    alignItems: 'center',
  },
  settingsIcon: {
    fontSize: 20,
    color: colors.textMuted,
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  modeTabActive: {
    borderBottomColor: colors.primary,
  },
  modeTabIcon: {
    fontSize: 16,
  },
  modeTabIconActive: {},
  modeTabLabel: {
    ...typography.small,
    color: colors.textMuted,
    fontWeight: '600',
  },
  modeTabLabelActive: {
    color: colors.primary,
  },
  content: {
    flex: 1,
  },
});
