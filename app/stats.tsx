import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReadingCalendar from '../src/components/ReadingCalendar';
import StatsCard from '../src/components/StatsCard';
import { useLibraryStore } from '../src/store/libraryStore';
import { useStatsStore } from '../src/store/statsStore';
import { colors, radius, spacing, typography } from '../src/theme';

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${Math.round(totalMinutes)}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDurationShort(ms: number): string {
  const totalMinutes = ms / 60000;
  return formatMinutes(totalMinutes);
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const DAILY_GOAL_MINUTES = 30;

export default function StatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sessions = useStatsStore((s) => s.sessions);
  const completedBooks = useStatsStore((s) => s.completedBooks);
  const books = useLibraryStore((s) => s.books);

  // Compute stats from sessions (replaces the removed s.stats)
  const stats = useMemo(() => {
    let totalReadingTimeMs = 0;
    let totalAudioMinutes = 0;
    const dailyMinutes: Record<string, number> = {};
    const uniqueDays = new Set<string>();

    for (const s of sessions) {
      if (s.endTime && s.durationMs) {
        const day = new Date(s.endTime).toISOString().slice(0, 10);
        uniqueDays.add(day);
        const minutes = s.durationMs / 60000;
        dailyMinutes[day] = (dailyMinutes[day] ?? 0) + minutes;
        if (s.mode === 'ebook') totalReadingTimeMs += s.durationMs;
        else totalAudioMinutes += minutes;
      }
    }

    const sortedDays = [...uniqueDays].sort();
    let longestStreak = 0;
    let run = 0;
    for (let i = 0; i < sortedDays.length; i++) {
      if (i === 0) { run = 1; }
      else {
        const prev = new Date(sortedDays[i - 1]).getTime();
        const curr = new Date(sortedDays[i]).getTime();
        if ((curr - prev) / 86400000 === 1) { run++; }
        else { run = 1; }
      }
      longestStreak = Math.max(longestStreak, run);
    }

    let currentStreak = 0;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const last = sortedDays[sortedDays.length - 1];
    if (last === today || last === yesterday) {
      currentStreak = 1;
      for (let i = sortedDays.length - 2; i >= 0; i--) {
        const curr = new Date(sortedDays[i + 1]).getTime();
        const prev = new Date(sortedDays[i]).getTime();
        if ((curr - prev) / 86400000 === 1) currentStreak++;
        else break;
      }
    }

    return {
      totalBooksRead: new Set(sessions.map((s) => s.bookId)).size,
      totalBooksCompleted: completedBooks.size,
      totalReadingTimeMs,
      totalAudioMinutes,
      longestStreak,
      currentStreak,
      dailyMinutes,
    };
  }, [sessions, completedBooks]);

  const bookMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of books) map[b.id] = b.title;
    return map;
  }, [books]);

  const todayKey = useMemo(() => {
    return new Date().toISOString().slice(0, 10);
  }, []);

  const todayMinutes = useMemo(() => {
    return sessions
      .filter((s) => {
        if (s.endTime == null) return false;
        const d = new Date(s.startTime).toISOString().slice(0, 10);
        return d === todayKey;
      })
      .reduce((sum, s) => sum + (s.durationMs ?? 0), 0) / 60000;
  }, [sessions, todayKey]);
  const goalProgress = Math.min(todayMinutes / DAILY_GOAL_MINUTES, 1);

  // Average reading pace: pages per hour (for PDF sessions that have pagesRead)
  const readingPace = useMemo(() => {
    const ebookSessions = sessions.filter(
      (s) => s.endTime != null && s.mode === 'ebook',
    );
    const totalPages = ebookSessions.reduce(
      (sum, _s) => sum + 0,
      0,
    );
    const totalHours = ebookSessions.reduce(
      (sum, s) => sum + (s.durationMs ?? 0),
      0,
    ) / 3600000;
    if (totalHours <= 0 || totalPages <= 0) return null;
    return `${Math.round(totalPages / totalHours)} pp/h`;
  }, [sessions]);

  const recentSessions = useMemo(() => {
    return [...sessions]
      .filter((s) => s.endTime != null)
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))
      .slice(0, 15);
  }, [sessions]);

  const totalEbookTime = useMemo(() => {
    return sessions
      .filter((s) => s.endTime != null && s.mode === 'ebook')
      .reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  }, [sessions]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={12}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Reading Stats</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        {/* Daily goal */}
        <View style={styles.goalCard}>
          <Text style={styles.goalTitle}>Today's Reading</Text>
          <View style={styles.goalBarOuter}>
            <View
              style={[
                styles.goalBarFill,
                { flex: goalProgress > 0 ? goalProgress : 0.01 },
                goalProgress >= 1 && styles.goalBarComplete,
              ]}
            />
          </View>
          <Text style={styles.goalText}>
            {formatMinutes(todayMinutes)} / {DAILY_GOAL_MINUTES}m daily goal
            {goalProgress >= 1 ? ' ✓' : ''}
          </Text>
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <StatsCard
            title="Books Read"
            value={String(stats.totalBooksRead)}
            icon="📖"
          />
          <StatsCard
            title="Completed"
            value={String(stats.totalBooksCompleted)}
            icon="✅"
            accent={colors.success}
          />
          <StatsCard
            title="Total Reading"
            value={formatMinutes(stats.totalReadingTimeMs / 60000)}
            icon="⏱"
            accent={colors.accent}
          />
          <StatsCard
            title="Audio Time"
            value={formatMinutes(stats.totalAudioMinutes)}
            icon="🎧"
            accent={colors.primaryLight}
          />
          {readingPace != null && (
            <StatsCard
              title="Reading Pace"
              value={readingPace}
              icon="📄"
            />
          )}
          <StatsCard
            title="Longest Streak"
            value={`${stats.longestStreak} days`}
            subtitle={
              stats.currentStreak > 0
                ? `${stats.currentStreak}-day current streak`
                : undefined
            }
            icon="🔥"
            accent={colors.accent}
          />
        </View>

        {/* Reading calendar */}
        <Text style={styles.sectionTitle}>Reading Activity</Text>
        <ReadingCalendar dailyMinutes={stats.dailyMinutes} />

        {/* Recent sessions */}
        {recentSessions.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Recent Sessions</Text>
            <View style={styles.sessionsList}>
              {recentSessions.map((s) => (
                <View key={s.id} style={styles.sessionRow}>
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionBook} numberOfLines={1}>
                      {bookMap[s.bookId] ?? 'Unknown'}
                    </Text>
                    <Text style={styles.sessionMeta}>
                      {s.mode === 'ebook' ? '📖' : '🎧'}{' '}
                      {formatDate(s.startTime)}
                      {s.durationMs != null &&
                        ` · ${formatDurationShort(s.durationMs)}`}
                    </Text>
                  </View>
                  {s.mode === 'ebook' ? (
                    <Text style={styles.sessionProgress}>
                      ch. {(s.chapterEnd ?? s.chapterStart) + 1}
                    </Text>
                  ) : (
                    <Text style={styles.sessionProgress}>
                      {formatDurationShort(s.durationMs ?? 0)}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {sessions.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyText}>
              Start reading to see your stats here
            </Text>
          </View>
        )}
      </ScrollView>
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  headerTitle: {
    flex: 1,
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  goalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  goalTitle: {
    ...typography.small,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  goalBarOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  goalBarFill: {
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  goalBarComplete: {
    backgroundColor: colors.success,
  },
  goalText: {
    ...typography.tiny,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'right',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.small,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: -spacing.xs,
    marginTop: spacing.xs,
  },
  sessionsList: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sessionInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  sessionBook: {
    ...typography.small,
    color: colors.text,
    fontWeight: '600',
  },
  sessionMeta: {
    ...typography.tiny,
    color: colors.textMuted,
    marginTop: 2,
  },
  sessionProgress: {
    ...typography.small,
    color: colors.primaryLight,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
