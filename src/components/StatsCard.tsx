import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';

interface Props {
  icon: string;
  label: string;
  value: string | number;
  color?: string;
}

export default function StatsCard({ icon, label, value, color = colors.primary }: Props) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconRing, { borderColor: color + '40' }]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface + 'CC',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minWidth: 110,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border + '80',
    gap: spacing.xs,
  },
  iconRing: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: 16,
  },
  value: {
    ...typography.h3,
    color: colors.text,
  },
  label: {
    ...typography.tiny,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
});
