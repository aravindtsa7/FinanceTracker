import { StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';

export interface SummaryItem {
  label: string;
  value: string | number;
  color?: string;
}

/** At most two figures per row, with a full measured width for fitted amounts. */
export function SummaryStrip({ items }: { items: SummaryItem[] }) {
  const { compact, metricFontSize } = useResponsiveLayout();
  const wrap = items.length >= 3 || (compact && items.length > 1);
  return (
    <View style={[styles.strip, wrap && styles.wrappedStrip]}>
      {items.map((item, i) => (
        <View key={item.label} style={[styles.item, wrap && styles.wrappedItem, (wrap ? i % 2 !== 0 : i > 0) && styles.divider]}>
          <Text style={[styles.value, { fontSize: metricFontSize }, item.color ? { color: item.color } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
            {item.value}
          </Text>
          <Text style={styles.label}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    backgroundColor: Colors.navy,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
  },
  item: { flex: 1, minWidth: 0, paddingHorizontal: Spacing.md, gap: 4 },
  wrappedStrip: { flexWrap: 'wrap', paddingVertical: Spacing.sm },
  wrappedItem: { flexGrow: 0, flexShrink: 0, flexBasis: '50%', paddingVertical: Spacing.sm },
  divider: { borderLeftWidth: 1, borderLeftColor: Colors.navyLight },
  value: { width: '100%', textAlign: 'center', fontWeight: '800', color: Colors.textOnDark },
  label: { fontSize: 12, color: Colors.tabInactive, textAlign: 'center' },
});
