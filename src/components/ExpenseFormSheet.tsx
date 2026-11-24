import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { DateField } from '@/components/DateField';
import { FormField } from '@/components/FormField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { addExpense, updateExpense } from '@/db/database';
import type { Expense } from '@/types/finance';
import { todayStr } from '@/utils/date';
import { expenseFormErrors, expenseInputFromForm, type ExpenseFormValues } from '@/utils/expenseForm';
import { sanitizeDecimalInput, toInputString } from '@/utils/number';

const CATEGORIES = ['Office', 'Travel', 'Salary', 'Stationery', 'Commission', 'Miscellaneous', 'Other'];
const MODES = [{ value: 'Cash', label: 'Cash' }, { value: 'UPI', label: 'UPI' }] as const;

export function ExpenseFormSheet({ visible, expense, onClose, onSaved }: {
  visible: boolean;
  expense: Expense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <BottomSheet visible={visible} tall title={expense ? 'Edit Expense' : 'Add Expense'}
      onClose={() => { if (!saving) onClose(); }}>
      {visible && <ExpenseForm key={expense?.id ?? 'new'} expense={expense} onSaved={onSaved} onBusyChange={setSaving} />}
    </BottomSheet>
  );
}

function ExpenseForm({ expense, onSaved, onBusyChange }: {
  expense: Expense | null;
  onSaved: () => void;
  onBusyChange: (saving: boolean) => void;
}) {
  const [values, setValues] = useState<ExpenseFormValues>(() => ({
    title: expense?.title ?? '', category: expense?.category ?? '',
    amount: expense ? toInputString(expense.amount) : '', expense_date: expense?.expense_date ?? todayStr(),
    payment_mode: expense?.payment_mode ?? 'Cash', notes: expense?.notes ?? '',
  }));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const running = useRef(false);
  const errors = submitted ? expenseFormErrors(values) : {};
  const field = <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (running.current) return;
    setSubmitted(true);
    if (Object.keys(expenseFormErrors(values)).length) return;
    running.current = true;
    setSaving(true);
    onBusyChange(true);
    try {
      const input = expenseInputFromForm(values);
      if (expense) await updateExpense(expense.id, input);
      else await addExpense(input);
      onSaved();
    } catch (error) {
      Alert.alert('Could not save expense', error instanceof Error ? error.message : String(error));
    } finally {
      running.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  };

  return (
    <View style={styles.form}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        pointerEvents={saving ? 'none' : 'auto'}>
        <FormField label="Title / Description" required value={values.title} onChangeText={(text) => field('title', text)}
          placeholder="e.g. Office rent" error={errors.title} />
        <View style={styles.categories}>
          {CATEGORIES.map((category) => (
            <Pressable key={category} onPress={() => field('category', category)} accessibilityRole="button"
              accessibilityState={{ selected: values.category === category }} accessibilityLabel={`Category ${category}`}
              style={[styles.chip, values.category === category && styles.selected]}>
              <Text style={[styles.chipText, values.category === category && styles.selectedText]}>{category}</Text>
            </Pressable>
          ))}
        </View>
        <FormField label="Category" required value={values.category} onChangeText={(text) => field('category', text)}
          placeholder="Select above or enter a custom category" error={errors.category} />
        <FormField label="Amount (₹)" required prefix="₹" keyboardType="decimal-pad" value={values.amount}
          onChangeText={(text) => field('amount', sanitizeDecimalInput(text))} error={errors.amount} placeholder="0.00" />
        <DateField label="Expense Date" required value={values.expense_date}
          onChange={(date) => field('expense_date', date)} error={errors.expense_date} />
        <View style={styles.mode}>
          <Text style={styles.label}>Payment Mode</Text>
          <SegmentedControl options={MODES} value={values.payment_mode} onChange={(mode) => field('payment_mode', mode)}
            accessibilityLabel="Expense payment mode" />
        </View>
        <FormField label="Notes" multiline value={values.notes} onChangeText={(text) => field('notes', text)} placeholder="Optional notes" />
      </ScrollView>
      <AppButton label={expense ? 'Save Changes' : 'Save Expense'} icon="checkmark-circle" loading={saving} onPress={() => void save()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, gap: Spacing.md },
  scroll: { flex: 1 },
  content: { gap: Spacing.md, paddingBottom: Spacing.md },
  mode: { gap: Spacing.sm },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { maxWidth: '100%', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, minHeight: 40, justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  selected: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  chipText: { color: Colors.navy, fontSize: 13, fontWeight: '600' },
  selectedText: { color: Colors.textOnDark },
});
