import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text, AppTextInput as TextInput } from '@/components/AppText';
import { EmptyState } from '@/components/EmptyState';
import { FilterChips } from '@/components/FilterChips';
import { LoanCard } from '@/components/LoanCard';
import { ErrorBanner } from '@/components/ScreenState';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getLoans } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import type { LoanStatus, TenureType } from '@/types/finance';
import { formatCurrency } from '@/utils/format';
import { roundMoney } from '@/utils/loanCalculations';

const STATUS_FILTERS = ['All', 'Active', 'Overdue', 'Completed'] as const;
const TENURE_FILTERS = ['All', 'Daily', 'Weekly', 'Monthly'] as const;

interface LoanFilters {
  status: LoanStatus | 'All';
  tenure: TenureType | 'All';
  search: string;
}

const loadLoans = (f: LoanFilters) => getLoans(f.status, f.search, f.tenure);
const openNewLoan = () => router.push('/loan/new');

const isStatusFilter = (value: unknown): value is LoanStatus | 'All' =>
  (STATUS_FILTERS as readonly unknown[]).includes(value);

export default function LoansScreen() {
  const { pagePadding } = useResponsiveLayout();
  // The status filter lives in the route (`/loans?status=Overdue`) so other screens can deep-link to it.
  const params = useLocalSearchParams<{ status?: string }>();
  const status = isStatusFilter(params.status) ? params.status : 'All';
  const setStatus = (value: LoanStatus | 'All') => router.setParams({ status: value });
  const [search, setSearch] = useState('');
  const [tenure, setTenure] = useState<TenureType | 'All'>('All');
  const debouncedSearch = useDebouncedValue(search.trim(), 200);
  const { data: loans, error, loading, reload } = useDbQuery(loadLoans, {
    status,
    tenure,
    search: debouncedSearch,
  });

  const list = loans ?? [];
  const principal = roundMoney(list.reduce((sum, l) => sum + l.loan_amount, 0));
  const balance = roundMoney(list.reduce((sum, l) => sum + l.balance_amount, 0));
  const filtered = status !== 'All' || tenure !== 'All' || debouncedSearch.length > 0;

  const listHeader = (
    <View style={styles.listHeader}>
      <ErrorBanner error={error} />

      {/* Sleek compact 3-column metric card */}
      <View style={styles.metricCard}>
        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>{filtered ? 'Matching' : 'Total Loans'}</Text>
          <Text style={styles.metricValue}>{list.length}</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>Principal Out</Text>
          <Text style={styles.metricValue}>{formatCurrency(principal)}</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>Balance Due</Text>
          <Text style={[styles.metricValue, styles.metricBalance]}>{formatCurrency(balance)}</Text>
        </View>
      </View>

      {/* Compact horizontal scrollable pill filters */}
      <View style={styles.filterSection}>
        <FilterChips compact label="Status" options={STATUS_FILTERS} value={status} onChange={setStatus} />
        <FilterChips compact label="Tenure" options={TENURE_FILTERS} value={tenure} onChange={setTenure} />
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      {/* Slim search bar fixed at top */}
      <View style={[styles.topFixed, { paddingHorizontal: pagePadding }]}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer name or phone"
            placeholderTextColor={Colors.tabInactive}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search loans"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(l) => String(l.id)}
        renderItem={({ item }) => (
          <LoanCard
            loan={item}
            showCustomer
            onPress={() => router.push({ pathname: '/loan/[id]', params: { id: String(item.id) } })}
          />
        )}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[styles.list, { paddingHorizontal: pagePadding }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={loading && !!loans} onRefresh={reload} />}
        ListEmptyComponent={loans ? <LoansEmpty filtered={filtered} /> : null}
      />

      <Pressable
        onPress={openNewLoan}
        accessibilityRole="button"
        accessibilityLabel="New loan"
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
        <Ionicons name="add" size={22} color={Colors.textOnDark} />
        <Text style={styles.fabText}>New Loan</Text>
      </Pressable>
    </View>
  );
}

function LoansEmpty({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return <EmptyState icon="filter-outline" title="No matching loans" message="Try a different search or filter." />;
  }
  return (
    <EmptyState
      icon="cash-outline"
      title="No loans yet"
      message="Issue your first loan to start tracking collections."
      action={<AppButton label="New Loan" icon="add-circle" onPress={openNewLoan} />}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  topFixed: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    backgroundColor: Colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    minHeight: 38,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 6 },
  list: { paddingTop: Spacing.xs, paddingBottom: 96, gap: 8 },
  listHeader: {
    gap: 8,
    paddingBottom: 8,
  },
  metricCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  metricDivider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.border,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  metricBalance: {
    color: Colors.emeraldDark,
  },
  filterSection: {
    gap: 4,
    marginTop: 2,
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    backgroundColor: Colors.emeraldDark,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 12,
    borderRadius: 24,
    elevation: 4,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  fabText: { color: Colors.textOnDark, fontWeight: '700', fontSize: 14 },
});
