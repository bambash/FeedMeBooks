import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';

interface Props {
  title: string;
  value: string;
  subtitle?: string;
  icon?: string;
  accent?: string;
}

export default function StatsCard({
  title,
  value,
  subtitle,
  icon,
  accent = colors.primary,
}: Props) {
  return (
    <View style={[styles.card, { borderLeftColor: accent }]}>
      <View style={styles.header}>
        {icon != null && <Text style={styles.icon}>{icon}</Text>}
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={[styles.value, { color: accent }]}>{value}</Text>
      {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    padding: spacing.md,
    minWidth: '45%',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: 14,
  },
  title: {
    ...typography.tiny,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  value: {
    ...typography.h2,
    fontVariant: ['tabular-nums'],
  },
  subtitle: {
    ...typography.tiny,
    color: colors.textMuted,
    marginTop: 2,
  },
});
