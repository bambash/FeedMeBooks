import { Audio, AVPlaybackStatus } from 'expo-av';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { formatDuration } from '../utils/fileUtils';

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

interface Props {
  uris: string[];
  fileIndex: number; // saved track index
  savedPosition: number; // seconds within that track
  onPositionChange: (fileIndex: number, seconds: number) => void;
  /** Called once per track when its duration becomes known */
  onDurationLoaded?: (fileIndex: number, seconds: number) => void;
  bookTitle: string;
  /** If true, renders a compact strip instead of the full player */
  compact?: boolean;
}

export default function AudioPlayer({
  uris,
  fileIndex,
  savedPosition,
  onPositionChange,
  onDurationLoaded,
  bookTitle,
  compact = false,
}: Props) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [currentIndex, setCurrentIndex] = useState(fileIndex);
  const [status, setStatus] = useState<{
    isLoaded: boolean;
    isPlaying: boolean;
    positionMs: number;
    durationMs: number;
    isBuffering: boolean;
  }>({ isLoaded: false, isPlaying: false, positionMs: 0, durationMs: 0, isBuffering: false });
  const [speedIndex, setSpeedIndex] = useState(2); // 1.0x
  const [loading, setLoading] = useState(true);
  const positionSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs current so callbacks inside effects see latest values
  const urisRef = useRef(uris);
  urisRef.current = uris;
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;
  const onDurationLoadedRef = useRef(onDurationLoaded);
  onDurationLoadedRef.current = onDurationLoaded;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const speedIndexRef = useRef(speedIndex);
  speedIndexRef.current = speedIndex;
  // Track whether we've reported duration for the current track
  const durationReportedRef = useRef(false);

  // Load sound whenever the active track changes
  useEffect(() => {
    let sound: Audio.Sound | null = null;
    const uri = urisRef.current[currentIndex];
    if (!uri) return;

    setLoading(true);
    durationReportedRef.current = false;
    setStatus({ isLoaded: false, isPlaying: false, positionMs: 0, durationMs: 0, isBuffering: false });

    (async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        });

        const startMs = currentIndex === fileIndex ? savedPosition * 1000 : 0;

        const { sound: s } = await Audio.Sound.createAsync(
          { uri },
          {
            shouldPlay: false,
            positionMillis: startMs,
            rate: SPEEDS[speedIndexRef.current],
            shouldCorrectPitch: true,
          },
          (st) => {
            if (!st.isLoaded) {
              if (st.error) console.error('Playback error:', st.error);
              return;
            }
            if (st.didJustFinish) {
              const next = currentIndexRef.current + 1;
              if (next < urisRef.current.length) {
                onPositionChangeRef.current(next, 0);
                setCurrentIndex(next);
              }
              return;
            }
            const durationMs = st.durationMillis ?? 0;
            if (!durationReportedRef.current && durationMs > 0) {
              durationReportedRef.current = true;
              onDurationLoadedRef.current?.(currentIndexRef.current, durationMs / 1000);
            }
            setStatus({
              isLoaded: true,
              isPlaying: st.isPlaying,
              positionMs: st.positionMillis,
              durationMs,
              isBuffering: st.isBuffering,
            });
          },
        );
        sound = s;
        soundRef.current = s;
        setLoading(false);
      } catch (e) {
        console.error('Audio load error:', e);
        setLoading(false);
      }
    })();

    return () => {
      sound?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, [currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist position every 5 seconds while playing
  useEffect(() => {
    if (status.isPlaying) {
      positionSaveTimer.current = setInterval(() => {
        onPositionChange(currentIndex, status.positionMs / 1000);
      }, 5000);
    } else {
      if (positionSaveTimer.current) clearInterval(positionSaveTimer.current);
    }
    return () => {
      if (positionSaveTimer.current) clearInterval(positionSaveTimer.current);
    };
  }, [status.isPlaying, status.positionMs, currentIndex, onPositionChange]);

  const togglePlay = useCallback(async () => {
    if (!soundRef.current) return;
    if (status.isPlaying) {
      await soundRef.current.pauseAsync();
      onPositionChange(currentIndex, status.positionMs / 1000);
    } else {
      await soundRef.current.playAsync();
    }
  }, [status.isPlaying, status.positionMs, currentIndex, onPositionChange]);

  const seek = useCallback(async (seconds: number) => {
    if (!soundRef.current) return;
    const ms = Math.max(0, Math.min(seconds * 1000, status.durationMs));
    await soundRef.current.setPositionAsync(ms);
    onPositionChange(currentIndex, ms / 1000);
  }, [status.durationMs, currentIndex, onPositionChange]);

  const skipBack = useCallback(() => seek((status.positionMs / 1000) - 15), [seek, status.positionMs]);
  const skipForward = useCallback(() => seek((status.positionMs / 1000) + 30), [seek, status.positionMs]);

  const prevTrack = useCallback(() => {
    if (currentIndex > 0) {
      onPositionChange(currentIndex - 1, 0);
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, onPositionChange]);

  const nextTrack = useCallback(() => {
    if (currentIndex < uris.length - 1) {
      onPositionChange(currentIndex + 1, 0);
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, uris.length, onPositionChange]);

  const cycleSpeed = useCallback(async () => {
    const nextIndex = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextIndex);
    if (soundRef.current) {
      await soundRef.current.setRateAsync(SPEEDS[nextIndex], true);
    }
  }, [speedIndex]);

  const progress = status.durationMs > 0 ? status.positionMs / status.durationMs : 0;
  const multiTrack = uris.length > 1;

  if (loading) {
    return (
      <View style={compact ? styles.compactLoader : styles.fullLoader}>
        <ActivityIndicator size={compact ? 'small' : 'large'} color={colors.primary} />
      </View>
    );
  }

  if (compact) {
    return <CompactPlayer
      isPlaying={status.isPlaying}
      isBuffering={status.isBuffering}
      positionMs={status.positionMs}
      durationMs={status.durationMs}
      progress={progress}
      trackLabel={multiTrack ? `${currentIndex + 1}/${uris.length}` : undefined}
      onTogglePlay={togglePlay}
      onSeek={seek}
      onPrevTrack={multiTrack && currentIndex > 0 ? prevTrack : undefined}
      onNextTrack={multiTrack && currentIndex < uris.length - 1 ? nextTrack : undefined}
    />;
  }

  return (
    <View style={styles.fullContainer}>
      {/* Album art placeholder */}
      <View style={styles.albumArt}>
        <Text style={styles.albumArtIcon}>🎧</Text>
        <Text style={styles.albumTitle} numberOfLines={2}>{bookTitle}</Text>
      </View>

      {/* Track indicator */}
      {multiTrack && (
        <Text style={styles.trackLabel}>Track {currentIndex + 1} / {uris.length}</Text>
      )}

      {/* Time display */}
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatDuration(status.positionMs / 1000)}</Text>
        <Text style={styles.timeText}>{formatDuration(status.durationMs / 1000)}</Text>
      </View>

      {/* Progress bar */}
      <SeekBar
        progress={progress}
        durationMs={status.durationMs}
        onSeek={seek}
      />

      {/* Controls */}
      <View style={styles.controls}>
        {multiTrack ? (
          <Pressable style={[styles.controlBtn, currentIndex === 0 && styles.controlBtnDisabled]} onPress={prevTrack} disabled={currentIndex === 0}>
            <Text style={styles.controlIcon}>⏮</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.controlBtn} onPress={skipBack}>
            <Text style={styles.controlIcon}>⟨15</Text>
          </Pressable>
        )}

        <Pressable style={styles.playBtn} onPress={togglePlay}>
          {status.isBuffering ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.playIcon}>{status.isPlaying ? '⏸' : '▶'}</Text>
          )}
        </Pressable>

        {multiTrack ? (
          <Pressable style={[styles.controlBtn, currentIndex === uris.length - 1 && styles.controlBtnDisabled]} onPress={nextTrack} disabled={currentIndex === uris.length - 1}>
            <Text style={styles.controlIcon}>⏭</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.controlBtn} onPress={skipForward}>
            <Text style={styles.controlIcon}>30⟩</Text>
          </Pressable>
        )}
      </View>

      {/* Skip buttons shown below when multi-track */}
      {multiTrack && (
        <View style={styles.skipRow}>
          <Pressable style={styles.controlBtn} onPress={skipBack}>
            <Text style={styles.controlIcon}>⟨15</Text>
          </Pressable>
          <Pressable style={styles.controlBtn} onPress={skipForward}>
            <Text style={styles.controlIcon}>30⟩</Text>
          </Pressable>
        </View>
      )}

      {/* Speed */}
      <Pressable style={styles.speedBtn} onPress={cycleSpeed}>
        <Text style={styles.speedText}>{SPEEDS[speedIndex].toFixed(2).replace('.00', '')}×</Text>
      </Pressable>
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// SeekBar
// ────────────────────────────────────────────────────────────
interface SeekBarProps {
  progress: number;
  durationMs: number;
  onSeek: (seconds: number) => void;
}

function SeekBar({ progress, durationMs, onSeek }: SeekBarProps) {
  const [barWidth, setBarWidth] = useState(1);

  const handlePress = useCallback(
    (event: any) => {
      const x = event.nativeEvent.locationX;
      const ratio = Math.max(0, Math.min(x / barWidth, 1));
      onSeek((ratio * durationMs) / 1000);
    },
    [barWidth, durationMs, onSeek],
  );

  return (
    <Pressable
      style={styles.seekBarOuter}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      onPress={handlePress}
    >
      <View style={[styles.seekBarFill, { width: `${progress * 100}%` }]} />
      <View style={[styles.seekBarThumb, { left: `${progress * 100}%` }]} />
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────
// Compact player strip shown while reading ebook
// ────────────────────────────────────────────────────────────
interface CompactPlayerProps {
  isPlaying: boolean;
  isBuffering: boolean;
  positionMs: number;
  durationMs: number;
  progress: number;
  trackLabel?: string;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onPrevTrack?: () => void;
  onNextTrack?: () => void;
}

function CompactPlayer({
  isPlaying,
  isBuffering,
  positionMs,
  durationMs,
  progress,
  trackLabel,
  onTogglePlay,
  onSeek,
  onPrevTrack,
  onNextTrack,
}: CompactPlayerProps) {
  return (
    <View style={styles.compactContainer}>
      <SeekBar progress={progress} durationMs={durationMs} onSeek={onSeek} />
      <View style={styles.compactRow}>
        <Text style={styles.compactTime}>{formatDuration(positionMs / 1000)}</Text>
        {onPrevTrack && (
          <Pressable style={styles.compactTrackBtn} onPress={onPrevTrack}>
            <Text style={styles.compactTrackIcon}>⏮</Text>
          </Pressable>
        )}
        <Pressable style={styles.compactPlayBtn} onPress={onTogglePlay}>
          {isBuffering ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.compactPlayIcon}>{isPlaying ? '⏸' : '▶'}</Text>
          )}
        </Pressable>
        {onNextTrack && (
          <Pressable style={styles.compactTrackBtn} onPress={onNextTrack}>
            <Text style={styles.compactTrackIcon}>⏭</Text>
          </Pressable>
        )}
        {trackLabel ? (
          <Text style={styles.compactTrackLabel}>{trackLabel}</Text>
        ) : (
          <Text style={styles.compactTime}>{formatDuration(durationMs / 1000)}</Text>
        )}
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fullLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  compactLoader: {
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  fullContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  albumArt: {
    width: 220,
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  albumArtIcon: {
    fontSize: 72,
    marginBottom: spacing.sm,
  },
  albumTitle: {
    ...typography.small,
    color: colors.primaryLight,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: spacing.xs,
  },
  timeText: {
    ...typography.small,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  seekBarOuter: {
    width: '100%',
    height: 40,
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  seekBarFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  seekBarThumb: {
    position: 'absolute',
    top: '50%',
    width: 14,
    height: 14,
    marginTop: -7,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.white,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    marginBottom: spacing.lg,
  },
  controlBtn: {
    padding: spacing.md,
  },
  controlIcon: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '700',
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  playIcon: {
    fontSize: 28,
    color: colors.white,
    marginLeft: 4,
  },
  trackLabel: {
    ...typography.small,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  skipRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginBottom: spacing.sm,
  },
  controlBtnDisabled: {
    opacity: 0.3,
  },
  speedBtn: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  speedText: {
    ...typography.small,
    color: colors.primaryLight,
    fontWeight: '700',
  },
  // Compact
  compactContainer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  compactTime: {
    ...typography.tiny,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    width: 50,
    textAlign: 'center',
  },
  compactPlayBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactPlayIcon: {
    fontSize: 16,
    color: colors.white,
    marginLeft: 2,
  },
  compactTrackBtn: {
    padding: spacing.xs,
  },
  compactTrackIcon: {
    fontSize: 14,
    color: colors.textMuted,
  },
  compactTrackLabel: {
    ...typography.tiny,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    width: 50,
    textAlign: 'center',
  },
});
