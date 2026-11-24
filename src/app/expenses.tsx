import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { AppText as Text, AppTextInput as TextInput } from '@/components/AppText';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { EmptyState } from '@/components/EmptyState';
import { ExpenseFormSheet } from '@/components/ExpenseFormSheet';
import { ErrorBanner } from '@/components/ScreenState';
import { SummaryStrip } from '@/components/SummaryStrip';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { deleteExpense, getExpenses } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import type { Expense } from '@/types/finance';
import { formatCurrency, formatDate } from '@/utils/format';
import { roundMoney } from '@/utils/loanCalculations';
import { dateRangeError, presetDateRange, type DateFilter } from '@/utils/reporting';

interface ExpenseFilters { date: DateFilter; search: string }
const loadExpenses = async (filters: ExpenseFilters) => ({
  key: JSON.stringify(filters),
  expenses: dateRangeError(filters.date) ? [] : await getExpenses(filters.date.fromDate, filters.date.toDate, filters.search),
});

export default function ExpensesScreen() {
  const { pagePadding } = useResponsiveLayout();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [filter, setFilter] = useState<DateFilter>(() => presetDateRange('All Time'));
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), 200);
  const filters = { date: filter, search: query };
  const { data, error, loading, reload } = useDbQuery(loadExpenses, filters);
  const [formOpen, setFormOpen] = useState(add === '1');
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const deletingRef = useRef(false);
  const insets = useSafeAreaInsets();
  const matchesFilter = !error && data?.key === JSON.stringify(filters);
  const list = matchesFilter && !dateRangeError(filter) ? data.expenses : [];
  const summaryPending = loading || !matchesFilter;
  const total = roundMoney(list.reduce((sum, expense) => sum + expense.amount, 0));
  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const closeForm = () => {
    setFormOpen(false);
    if (add) router.setParams({ add: undefined });
  };

  const confirmDelete = (expense: Expense) => {
    Alert.alert('Delete expense?', `Delete “${expense.title}” (${formatCurrency(expense.amount)})? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (deletingRef.current) return;
        deletingRef.current = true;
        setDeleting(expense.id);
        try {
          await deleteExpense(expense.id);
          await reload();
        } catch (e) {
          Alert.alert('Could not delete expense', e instanceof Error ? e.message : String(e));
        } finally {
          deletingRef.current = false;
          setDeleting(null);
        }
      } },
    ]);
  };

  return (
    <View style={styles.screen}>
      <Stack.Title>Expenses Tracker</Stack.Title>
      <FlatList data={list} keyExtractor={(expense) => String(expense.id)}
        contentContainerStyle={[styles.list, { paddingHorizontal: pagePadding, paddingBottom: 100 + insets.bottom }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <DateRangeFilter value={filter} onChange={setFilter} compactLabels />
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={Colors.textMuted} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search title, category or notes"
                placeholderTextColor={Colors.tabInactive} style={styles.searchInput} autoCorrect={false}
                accessibilityLabel="Search expenses" returnKeyType="search" />
              {!!search && <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
              </Pressable>}
            </View>
            <SummaryStrip items={[
              { label: 'Matching expenses', value: summaryPending ? (error ? '—' : '…') : list.length },
              { label: 'Total Expenses', value: summaryPending ? (error ? '—' : '…') : formatCurrency(total), color: Colors.emerald },
            ]} />
            {loading && <Text style={styles.meta}>Updating expenses…</Text>}
            <ErrorBanner error={error} />
            {error && <AppButton label="Retry" variant="secondary" onPress={reload} />}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.topRow}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
            </View>
            <View style={styles.badges}>
              <View style={styles.categoryBadge}><Text style={styles.category}>{item.category}</Text></View>
              <View style={[styles.modeBadge, item.payment_mode === 'UPI' && styles.upiBadge]}>
                <Text style={styles.mode}>{item.payment_mode}</Text>
              </View>
              <Text style={styles.meta}>{formatDate(item.expense_date)}</Text>
            </View>
            {!!item.notes && <Text style={styles.notes}>{item.notes}</Text>}
            <View style={styles.actions}>
              <AppButton label="Edit" icon="create-outline" variant="secondary" compact disabled={deleting !== null}
                onPress={() => { setEditing(item); setFormOpen(true); }} />
              <AppButton label="Delete" icon="trash-outline" variant="danger" compact loading={deleting === item.id}
                disabled={deleting !== null} onPress={() => confirmDelete(item)} />
            </View>
          </View>
        )}
        ListEmptyComponent={!loading && !error && !dateRangeError(filter) ? (
          <EmptyState icon="receipt-outline" title="No expenses found" message="Add an expense or change your dates and search."
            action={<AppButton label="Add Expense" icon="add-circle" onPress={openAdd} />} />
        ) : null}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Add expense" onPress={openAdd}
        style={({ pressed }) => [styles.fab, { bottom: Spacing.lg + insets.bottom }, pressed && styles.pressed]}>
        <Ionicons name="add" size={22} color={Colors.textOnDark} /><Text style={styles.fabLabel}>Add Expense</Text>
      </Pressable>
      <ExpenseFormSheet visible={formOpen} expense={editing} onClose={closeForm} onSaved={() => { closeForm(); void reload(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.lg, gap: Spacing.md },
  header: { gap: Spacing.md },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: Spacing.sm },
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'flex-start' },
  title: { flex: 1, minWidth: 140, fontSize: 17, fontWeight: '700', color: Colors.text },
  amount: { fontSize: 20, fontWeight: '800', color: Colors.danger },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  categoryBadge: { backgroundColor: Colors.navySoft, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4, maxWidth: '100%' },
  category: { color: Colors.navyLight, fontSize: 12, fontWeight: '700' },
  modeBadge: { backgroundColor: Colors.emeraldSoft, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  upiBadge: { backgroundColor: Colors.navySoft },
  mode: { fontSize: 12, fontWeight: '600', color: Colors.text },
  meta: { fontSize: 13, color: Colors.textMuted },
  notes: { fontSize: 14, lineHeight: 20, color: Colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  fab: { position: 'absolute', right: Spacing.lg, backgroundColor: Colors.emeraldDark, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', borderRadius: 28, padding: Spacing.lg, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  fabLabel: { color: Colors.textOnDark, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
