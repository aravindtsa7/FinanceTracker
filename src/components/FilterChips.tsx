import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';

interface FilterChipsProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  compact?: boolean;
  onChange: (value: T) => void;
}

/** Horizontally scrolling single-select chips, prefixed with a small label. */
export function FilterChips<T extends string>({ label, options, value, compact = false, onChange }: FilterChipsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, compact && styles.rowCompact]}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label} ${option}`}
            style={[styles.chip, compact && styles.chipCompact, selected && styles.chipSelected]}>
            <Text style={[styles.chipText, compact && styles.chipTextCompact, selected && styles.chipTextSelected]}>{option}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', gap: Spacing.sm, paddingRight: Spacing.lg },
  rowCompact: { gap: 6, paddingRight: Spacing.md },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, minWidth: 56, flexShrink: 0 },
  labelCompact: { fontSize: 11, minWidth: 46 },
  chip: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    flexShrink: 0,
  },
  chipCompact: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: 14,
  },
  chipSelected: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.navyLight },
  chipTextCompact: { fontSize: 12 },
  chipTextSelected: { color: Colors.textOnDark },
});
