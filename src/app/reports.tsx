import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { ExcelExportButtons } from '@/components/ExcelExportButtons';
import { ErrorBanner, SectionTitle } from '@/components/ScreenState';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getFinanceReport } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { formatCurrency } from '@/utils/format';
import { dateRangeError, earningsSummary, presetDateRange, type DateFilter } from '@/utils/reporting';

const loadReport = async (filter: DateFilter) => ({
  key: JSON.stringify(filter),
  report: dateRangeError(filter) ? null : await getFinanceReport(filter.fromDate, filter.toDate),
});

export default function ReportsScreen() {
  const { pagePadding } = useResponsiveLayout();
  const [filter, setFilter] = useState<DateFilter>(() => presetDateRange('All Time'));
  const { data, error, loading, reload } = useDbQuery(loadReport, filter);
  const report = !error && data?.key === JSON.stringify(filter) ? data.report : null;
  const earnings = report ? earningsSummary(report) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingHorizontal: pagePadding }]}
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}>
      <Stack.Title>Financial Reports</Stack.Title>
      <DateRangeFilter value={filter} onChange={setFilter} />
      <ErrorBanner error={error} />
      {error && <AppButton label="Retry" variant="secondary" onPress={reload} />}
      {loading && <View style={styles.loading}><ActivityIndicator color={Colors.emeraldDark} /><Text style={styles.note}>Updating report…</Text></View>}
      {report && earnings && (
        <>
          <ReportCard title="Document Charges Collected" amount={report.totalDocumentCharges} icon="document-text-outline"
            color={Colors.warning} detail={`Charges on ${report.loansCount} loans issued in range`} />
          <ReportCard title="Total Interest Collected" amount={report.totalInterestCollected} icon="trending-up-outline"
            color={Colors.emeraldDark} detail={`Expected interest: ${formatCurrency(report.totalInterestExpected)}`}
            note="Upfront interest is collected at disbursal. Add-to-total interest follows repayments, with the remainder recognized on completion. Expected interest covers loans issued in range." />
          <ReportCard title="Total Disbursal Amount" amount={report.totalDisbursedAmount} icon="cash-outline"
            color={Colors.navyLight} detail={`Principal loaned: ${formatCurrency(report.totalPrincipalLoaned)}`}
            note="Actual cash handed over to customers for loans issued in range." />
          <ReportCard title="Total Vasool / Payments Collected" amount={report.totalPaymentsCollected} icon="wallet-outline"
            color={Colors.emeraldDark} detail={`${report.paymentsCount} payments in range`} />
          <ReportCard title="Total Expenses" amount={report.totalExpenses} icon="receipt-outline"
            color={Colors.danger} detail={`${report.expensesCount} expenses in range`} />
          <SectionTitle>Net Earnings & Cash Flow</SectionTitle>
          <View style={styles.netCard}>
            <Text style={styles.netLabel}>Net Earnings</Text>
            <Text style={[styles.netValue, { color: earnings.netEarnings >= 0 ? Colors.emerald : '#FCA5A5' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {formatCurrency(earnings.netEarnings)}
            </Text>
            <Text style={styles.netNote}>Document charges + interest collected − expenses</Text>
            <View style={styles.divider} />
            <Text style={styles.netLabel}>Net Cash Flow</Text>
            <Text style={[styles.netValue, { color: earnings.netCashflow >= 0 ? Colors.emerald : '#FCA5A5' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {formatCurrency(earnings.netCashflow)}
            </Text>
            <Text style={styles.netNote}>Payments collected − cash disbursed − expenses</Text>
          </View>
        </>
      )}
      <SectionTitle>Export Full Data to Excel</SectionTitle>
      <ExcelExportButtons />
    </ScrollView>
  );
}

function ReportCard({ title, amount, detail, note, icon, color }: {
  title: string; amount: number; detail: string; note?: string;
  icon: ComponentProps<typeof Ionicons>['name']; color: string;
}) {
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.heading}>
        <Ionicons name={icon} size={21} color={color} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={[styles.amount, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{formatCurrency(amount)}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {!!note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  loading: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, padding: Spacing.lg, gap: Spacing.sm },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  amount: { fontSize: 28, fontWeight: '800' },
  detail: { fontSize: 14, fontWeight: '600', color: Colors.text },
  note: { fontSize: 12, lineHeight: 18, color: Colors.textMuted },
  netCard: { backgroundColor: Colors.navy, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  netLabel: { fontSize: 15, fontWeight: '700', color: Colors.textOnDark },
  netValue: { fontSize: 30, fontWeight: '800' },
  netNote: { color: '#CBD5E1', fontSize: 12, lineHeight: 18 },
  divider: { height: 1, backgroundColor: Colors.navyLight, marginVertical: Spacing.sm },
});
