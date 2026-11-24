import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text, AppTextInput as TextInput } from '@/components/AppText';
import { CollectPaymentSheet } from '@/components/CollectPaymentSheet';
import { DueLoanCard } from '@/components/DueLoanCard';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner, SectionTitle } from '@/components/ScreenState';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getDashboardStats, getRecentPayments, getTodayDueLoans } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import type { DueLoan, Payment } from '@/types/finance';
import { todayStr } from '@/utils/date';
import { formatCurrency, formatDate } from '@/utils/format';
import { loanBalanceDue, roundMoney } from '@/utils/loanCalculations';

type DueFilter = 'Pending' | 'Collected' | 'All';

async function loadDashboard(today: string) {
  // Stats first: it also promotes loans that have passed maturity to Overdue.
  const stats = await getDashboardStats(today);
  const [due, recent] = await Promise.all([getTodayDueLoans(today), getRecentPayments(8)]);
  return { stats, due, recent };
}

const isPending = (loan: DueLoan) => loan.paid_today < loan.due_today && loanBalanceDue(loan) > 0;
const openLoan = (loanId: number) => router.push({ pathname: '/loan/[id]', params: { id: String(loanId) } });

export default function DashboardScreen() {
  const { pagePadding } = useResponsiveLayout();
  const today = todayStr();
  const { data, error, loading, reload } = useDbQuery(loadDashboard, today);
  const [filter, setFilter] = useState<DueFilter>('Pending');
  const [collecting, setCollecting] = useState<DueLoan | null>(null);
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim().toLowerCase(), 150);
  const matchingDue = useMemo(() => (data?.due ?? []).filter((loan) => {
    const phoneQuery = query.replace(/\D/g, '');
    return !query || loan.customer_name.toLowerCase().includes(query) || loan.customer_phone.toLowerCase().includes(query) ||
      (/^[\d\s()+-]+$/.test(query) && !!phoneQuery && loan.customer_phone.replace(/\D/g, '').includes(phoneQuery));
  }), [data, query]);
  const pending = matchingDue.filter(isPending);
  const collected = matchingDue.filter((loan) => !isPending(loan));
  const visible = filter === 'Pending' ? pending : filter === 'Collected' ? collected : matchingDue;
  const stats = data?.stats;
  const chargesToday = stats?.todayChargesCollected ?? 0;
  const options = [
    { value: 'Pending', label: `Pending (${pending.length})` },
    { value: 'Collected', label: `Collected (${collected.length})` },
    { value: 'All', label: `All Due (${matchingDue.length})` },
  ] as const;

  const header = (
    <View style={styles.listHeader}>
      <ErrorBanner error={error} />
      {loading && !data && <ActivityIndicator color={Colors.emeraldDark} />}
      {error && <AppButton label="Retry" variant="outline" compact onPress={reload} />}
      <View style={styles.metricCard}>
        <Metric label="Today's Target" value={formatCurrency(stats?.todayTargetCollection ?? 0)} />
        <View style={styles.metricDivider} />
        <Metric label="Collected Today" value={formatCurrency(stats?.todayCollectedAmount ?? 0)} accent />
        <View style={styles.metricDivider} />
        <Metric label="Market Balance" value={formatCurrency(stats?.totalBalancePending ?? 0)} />
      </View>
      {chargesToday > 0 && <Text style={styles.chargesNote}>Collected today includes {formatCurrency(chargesToday)} extra charges. EMI targets use loan payments only.</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
        {options.map((option) => (
          <Pressable key={option.value} onPress={() => setFilter(option.value)} accessibilityRole="button"
            accessibilityLabel={option.label} accessibilityState={{ selected: filter === option.value }}
            style={[styles.chip, filter === option.value && styles.chipSelected]}>
            <Text style={[styles.chipText, filter === option.value && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.topFixed, { paddingHorizontal: pagePadding }]}>
        <View style={styles.topRow}>
          <View style={styles.dateWrap}>
            <Text style={styles.todayLabel}>Today</Text>
            <Text style={styles.date}>{formatDate(today)}</Text>
          </View>
          <AppButton label="+ Loan" compact onPress={() => router.push('/loan/new')} />
          <AppButton label="+ Customer" compact variant="secondary" onPress={() => router.push('/customer/form')} />
        </View>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search customer name or phone"
            placeholderTextColor={Colors.tabInactive} style={styles.searchInput} autoCorrect={false}
            returnKeyType="search" accessibilityLabel="Search today's collections" />
          {!!search && <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
          </Pressable>}
        </View>
      </View>
      <FlatList data={visible} keyExtractor={(loan) => String(loan.id)}
        renderItem={({ item }) => <DueLoanCard loan={item} onPress={() => openLoan(item.id)} onCollect={() => setCollecting(item)} />}
        ListHeaderComponent={header}
        ListEmptyComponent={data ? <DueEmpty filter={filter} dueCount={data.due.length} searching={!!query} /> : null}
        ListFooterComponent={data ? <RecentPayments payments={data.recent} /> : null}
        contentContainerStyle={[styles.list, { paddingHorizontal: pagePadding }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />} />
      <CollectPaymentSheet loan={collecting} onClose={() => setCollecting(null)} onSaved={() => {
        setCollecting(null);
        void reload();
      }} />
    </View>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.metricCol}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.metricCollected]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
    </View>
  );
}

function DueEmpty({ filter, dueCount, searching }: { filter: DueFilter; dueCount: number; searching: boolean }) {
  if (searching) return <EmptyState icon="search-outline" title="No matching collections" message="Try another name, phone number or filter." />;
  if (dueCount === 0) return <EmptyState icon="sunny-outline" title="No collections due today" message="New collections will appear here when due." />;
  if (filter === 'Pending') return <EmptyState icon="checkmark-done-circle-outline" title="All collected!" message="Every loan due today has met its EMI target." />;
  return <EmptyState icon="receipt-outline" title="No completed collections yet" message="Part-paid loans stay Pending until their EMI target is met." />;
}

function RecentPayments({ payments }: { payments: Payment[] }) {
  return (
    <View style={styles.recent}>
      <SectionTitle>Recent Vasool</SectionTitle>
      {!payments.length ? <Text style={styles.muted}>No payments recorded yet.</Text> : (
        <View style={styles.recentList}>
          {payments.map((payment, index) => (
            <Pressable key={payment.id} onPress={() => openLoan(payment.loan_id)} accessibilityRole="button"
              accessibilityLabel={`${payment.customer_name}, collected ${formatCurrency(payment.amount + (payment.charges_amount ?? 0))} on ${formatDate(payment.payment_date)}`}
              style={({ pressed }) => [styles.recentRow, index > 0 && styles.recentDivider, pressed && styles.pressed]}>
              <View style={styles.recentIcon}><Ionicons name={payment.payment_mode === 'UPI' ? 'phone-portrait-outline' : 'cash-outline'} size={16} color={Colors.emeraldDark} /></View>
              <View style={styles.flex1}>
                <Text style={styles.recentName} numberOfLines={1}>{payment.customer_name}</Text>
                <Text style={styles.muted}>{formatDate(payment.payment_date)} · {payment.payment_mode}</Text>
              </View>
              <View style={styles.recentAmountWrap}>
                <Text style={styles.recentAmount}>{formatCurrency(roundMoney(payment.amount + (payment.charges_amount ?? 0)))}</Text>
                {(payment.charges_amount ?? 0) > 0 && <Text style={styles.recentCharges}>{payment.amount > 0 ? `${formatCurrency(payment.amount)} EMI + ${formatCurrency(payment.charges_amount)} Charges` : `${formatCurrency(payment.charges_amount)} Charges only`}</Text>}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  topFixed: { paddingTop: Spacing.sm, paddingBottom: Spacing.xs, backgroundColor: Colors.background, gap: Spacing.sm },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs },
  dateWrap: { flex: 1, minWidth: 96 },
  todayLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted },
  date: { fontSize: 14, fontWeight: '700', color: Colors.text },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.sm + 2, minHeight: 38 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 6 },
  list: { paddingTop: Spacing.xs, paddingBottom: Spacing.xl, gap: 8 },
  listHeader: { gap: 8, paddingBottom: 8 },
  metricCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm },
  metricCol: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2 },
  metricDivider: { width: 1, height: 24, backgroundColor: Colors.border },
  metricLabel: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textAlign: 'center' },
  metricValue: { fontSize: 14, fontWeight: '700', color: Colors.text },
  metricCollected: { color: Colors.emeraldDark },
  chargesNote: { fontSize: 11, color: '#7E22CE' },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  chip: { paddingHorizontal: Spacing.sm + 2, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  chipSelected: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  chipText: { fontSize: 11, fontWeight: '600', color: Colors.navyLight },
  chipTextSelected: { color: Colors.textOnDark },
  flex1: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  muted: { fontSize: 11, color: Colors.textMuted },
  recent: { gap: Spacing.sm, marginTop: Spacing.md },
  recentList: { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  recentDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  recentIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.emeraldSoft, alignItems: 'center', justifyContent: 'center' },
  recentName: { fontSize: 13, fontWeight: '700', color: Colors.text },
  recentAmountWrap: { alignItems: 'flex-end', maxWidth: '100%' },
  recentAmount: { fontSize: 13, fontWeight: '800', color: Colors.emeraldDark },
  recentCharges: { fontSize: 10, fontWeight: '600', color: '#7E22CE' },
});
