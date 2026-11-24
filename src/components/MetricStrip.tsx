import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';

interface MetricItem {
  label: string;
  value: string | number;
  color?: string;
}

/** Compact horizontal metrics, matching the Loans and Dashboard cards. */
export function MetricStrip({ items }: { items: readonly MetricItem[] }) {
  return (
    <View style={styles.card}>
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 && <View style={styles.divider} />}
          <View style={styles.column} accessible accessibilityLabel={`${item.label}: ${item.value}`}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={[styles.value, !!item.color && { color: item.color }]} numberOfLines={1}
              adjustsFontSizeToFit minimumFontScale={0.75}>{item.value}</Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.sm,
  },
  column: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2 },
  divider: { width: 1, height: 24, backgroundColor: Colors.border },
  label: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textAlign: 'center' },
  value: { fontSize: 14, fontWeight: '700', color: Colors.text, maxWidth: '100%' },
});
