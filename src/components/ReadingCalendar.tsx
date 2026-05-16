import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';

interface Props {
  dailyMinutes: Record<string, number>;
}

const CELL_SIZE = 14;
const CELL_GAP = 3;
const WEEKS = 20;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function colorForMinutes(minutes: number): string {
  if (minutes <= 0) return colors.surfaceHigh;
  if (minutes < 15) return '#3D1C7A';
  if (minutes < 30) return '#5B2DA8';
  if (minutes < 60) return '#7C3AED';
  return '#9D6FF8';
}

export default function ReadingCalendar({ dailyMinutes }: Props) {
  const { grid, monthLabels, weekdays } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start from 20 weeks ago, aligned to Sunday
    const endDate = new Date(today);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (WEEKS * 7 - 1));
    // Align to Sunday (0 = Sunday)
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const rows: { date: string; minutes: number }[][] = Array.from(
      { length: 7 },
      () => [],
    );

    const monthPositions: { col: number; label: string }[] = [];
    let lastMonth = -1;

    for (let col = 0; col < WEEKS; col++) {
      for (let row = 0; row < 7; row++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + col * 7 + row);
        const dk = d.toISOString().slice(0, 10);
        const minutes = dailyMinutes[dk] ?? 0;
        rows[row].push({ date: dk, minutes });

        if (d <= today && row === 0 && d.getMonth() !== lastMonth) {
          monthPositions.push({ col, label: MONTHS[d.getMonth()] });
          lastMonth = d.getMonth();
        }
      }
    }

    return {
      grid: rows,
      monthLabels: monthPositions,
      weekdays: ['', 'Mon', '', 'Wed', '', 'Fri', ''],
    };
  }, [dailyMinutes]);

  return (
    <View style={styles.container}>
      <View style={styles.gridRow}>
        {/* Weekday labels */}
        <View style={styles.labelCol}>
          {weekdays.map((label, i) => (
            <Text key={i} style={styles.weekdayLabel}>
              {label}
            </Text>
          ))}
        </View>

        {/* Grid */}
        <View style={styles.grid}>
          {/* Month labels */}
          <View style={styles.monthRow}>
            {monthLabels.map((m, i) => (
              <Text
                key={i}
                style={[styles.monthLabel, { left: m.col * (CELL_SIZE + CELL_GAP) }]}
              >
                {m.label}
              </Text>
            ))}
          </View>

          {/* Cells */}
          {grid.map((row, rowIdx) => (
            <View key={rowIdx} style={styles.cellRow}>
              {row.map((cell, colIdx) => (
                <View
                  key={`${rowIdx}-${colIdx}`}
                  style={[
                    styles.cell,
                    { backgroundColor: colorForMinutes(cell.minutes) },
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendLabel}>Less</Text>
        {[0, 1, 15, 30, 60].map((threshold, i) => (
          <View
            key={i}
            style={[
              styles.legendCell,
              { backgroundColor: colorForMinutes(threshold) },
            ]}
          />
        ))}
        <Text style={styles.legendLabel}>More</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
  },
  labelCol: {
    marginRight: spacing.xs,
    justifyContent: 'flex-start',
    paddingTop: 14, // align with cells below month labels
  },
  weekdayLabel: {
    ...typography.tiny,
    color: colors.textFaint,
    lineHeight: CELL_SIZE + CELL_GAP,
    height: CELL_SIZE + CELL_GAP,
    width: 28,
    textAlign: 'right',
    marginRight: spacing.xs,
  },
  grid: {
    flex: 1,
  },
  monthRow: {
    height: 14,
    marginBottom: 2,
    position: 'relative',
  },
  monthLabel: {
    ...typography.tiny,
    color: colors.textFaint,
    position: 'absolute',
    top: 0,
    fontSize: 9,
  },
  cellRow: {
    flexDirection: 'row',
    gap: CELL_GAP,
    marginBottom: CELL_GAP,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 2,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  legendCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendLabel: {
    ...typography.tiny,
    color: colors.textFaint,
    fontSize: 9,
  },
});
