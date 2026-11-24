import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { DateField } from '@/components/DateField';
import { FilterChips } from '@/components/FilterChips';
import { ErrorBanner } from '@/components/ScreenState';
import { Spacing } from '@/constants/theme';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { dateRangeError, presetDateRange, type DateFilter, type DatePreset } from '@/utils/reporting';

type PresetLabel = DatePreset | 'All';

export function DateRangeFilter({ value, onChange, compactLabels = false }: {
  value: DateFilter;
  onChange: (value: DateFilter) => void;
  compactLabels?: boolean;
}) {
  const { compact } = useResponsiveLayout();
  const presets: PresetLabel[] = [compactLabels ? 'All' : 'All Time', 'This Month', 'Today', 'Custom Range'];
  return (
    <View style={styles.container}>
      <FilterChips label="Period" options={presets} value={compactLabels && value.preset === 'All Time' ? 'All' : value.preset} onChange={(label) => {
        const preset = label === 'All' ? 'All Time' : label;
        onChange(preset === 'Custom Range' ? { ...value, preset } : presetDateRange(preset));
      }} />
      <View style={styles.row}>
        <View style={[styles.field, compact && styles.fullField]}>
          <DateField label="From Date" value={value.fromDate ?? ''} placeholder="Any date"
            onChange={(fromDate) => onChange({ ...value, preset: 'Custom Range', fromDate })} />
        </View>
        <View style={[styles.field, compact && styles.fullField]}>
          <DateField label="To Date" value={value.toDate ?? ''} placeholder="Any date"
            onChange={(toDate) => onChange({ ...value, preset: 'Custom Range', toDate })} />
        </View>
      </View>
      <AppButton label="Clear / Reset Dates" icon="close-circle-outline" variant="secondary" compact
        onPress={() => onChange(presetDateRange('All Time'))} />
      <ErrorBanner error={dateRangeError(value)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  field: { flex: 1, minWidth: 160 },
  fullField: { flexBasis: '100%' },
});
