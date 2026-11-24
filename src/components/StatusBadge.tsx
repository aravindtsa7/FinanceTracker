import { StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { LoanStatus } from '@/types/finance';

export const STATUS_COLORS: Record<LoanStatus, { fg: string; bg: string }> = {
  Active: { fg: Colors.emeraldDark, bg: Colors.emeraldSoft },
  Overdue: { fg: Colors.danger, bg: Colors.dangerSoft },
  Completed: { fg: Colors.navyLight, bg: Colors.navySoft },
};

export function StatusBadge({ status }: { status: LoanStatus }) {
  const { fg, bg } = STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[styles.text, { color: fg }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexShrink: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  text: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
});
