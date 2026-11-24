import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppTextInput as TextInput } from '@/components/AppText';
import { CustomerCard } from '@/components/CustomerCard';
import { EmptyState } from '@/components/EmptyState';
import { FilterChips } from '@/components/FilterChips';
import { MetricStrip } from '@/components/MetricStrip';
import { ErrorBanner } from '@/components/ScreenState';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getCustomers } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { formatCurrency } from '@/utils/format';
import { roundMoney } from '@/utils/loanCalculations';

const CUSTOMER_FILTERS = ['All', 'Active Loans', 'Settled / None'] as const;
type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];
const loadCustomers = () => getCustomers();

const openForm = () => router.push('/customer/form');

export default function CustomersScreen() {
  const { pagePadding } = useResponsiveLayout();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CustomerFilter>('All');
  const query = useDebouncedValue(search.trim().toLowerCase(), 200);
  const { data, error, loading, reload } = useDbQuery(loadCustomers);
  // One snapshot supports instant filters/search and keeps business totals independent of filters.
  const summary = useMemo(() => ({
    total: data?.length ?? 0,
    active: data?.filter((customer) => customer.active_loans > 0).length ?? 0,
    balance: roundMoney(data?.reduce((sum, customer) => sum + customer.balance_due, 0) ?? 0),
  }), [data]);
  const customers = useMemo(() => (data ?? []).filter((customer) => {
    if (filter === 'Active Loans' && customer.active_loans === 0) return false;
    if (filter === 'Settled / None' && customer.active_loans > 0) return false;
    return !query || [customer.name, customer.phone, customer.alternate_phone, customer.kyc_number, customer.guarantor_name]
      .some((value) => value?.toLowerCase().includes(query));
  }), [data, filter, query]);
  const filtered = !!query || filter !== 'All';

  return (
    <View style={styles.screen}>
      <View style={[styles.topFixed, { paddingHorizontal: pagePadding }]}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Name, phone or KYC number"
            placeholderTextColor={Colors.tabInactive}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search customers"
            accessibilityHint="Search by name, primary or alternate phone, or KYC number"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
        <AppButton label="+ Customer" compact onPress={openForm} />
      </View>

      <FlatList
        data={customers}
        keyExtractor={(c) => String(c.id)}
        renderItem={({ item }) => (
          <CustomerCard
            customer={item}
            onPress={() => router.push({ pathname: '/customer/[id]', params: { id: String(item.id) } })}
          />
        )}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <ErrorBanner error={error} />
            <MetricStrip items={[
              { label: 'Total Customers', value: data ? summary.total : '—' },
              { label: 'Active Borrowers', value: data ? summary.active : '—' },
              { label: 'Total Balance Due', value: data ? formatCurrency(summary.balance) : '—', color: Colors.emeraldDark },
            ]} />
            <FilterChips compact label="Loans" options={CUSTOMER_FILTERS} value={filter} onChange={setFilter} />
          </View>
        }
        contentContainerStyle={[styles.list, { paddingHorizontal: pagePadding }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
        ListEmptyComponent={data ? <CustomersEmpty filtered={filtered} /> : null}
      />
    </View>
  );
}

function CustomersEmpty({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        icon="search-outline"
        title="No matches"
        message="Try another name, phone, KYC number or loan filter."
      />
    );
  }
  return (
    <EmptyState
      icon="people-outline"
      title="No customers yet"
      message="Add your first borrower to start issuing loans and tracking collections."
      action={<AppButton label="Add Customer" icon="person-add" onPress={openForm} />}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  topFixed: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingTop: Spacing.sm, paddingBottom: Spacing.xs, backgroundColor: Colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    minHeight: 38,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, color: Colors.text, paddingVertical: 6 },
  list: { paddingTop: Spacing.xs, paddingBottom: Spacing.xl, gap: 8 },
  listHeader: { gap: 8, paddingBottom: 8 },
});
