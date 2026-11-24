import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { DateField } from '@/components/DateField';
import { FormField } from '@/components/FormField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { addPayment } from '@/db/database';
import { scheduleAutoSync } from '@/services/googleDriveBackup';
import type { Loan, PaymentMode } from '@/types/finance';
import { todayStr } from '@/utils/date';
import { formatCurrency, formatTenure } from '@/utils/format';
import { roundMoney } from '@/utils/loanCalculations';
import { parseNumber, sanitizeDecimalInput, toInputString } from '@/utils/number';

const MODE_OPTIONS = [
  { value: 'Cash', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
] as const;

/** Any loan; a `DueLoan` from the dashboard also carries what was already collected today. */
type CollectableLoan = Loan & { paid_today?: number };

interface CollectPaymentSheetProps {
  /** The loan to collect for; the sheet is open while this is non-null. */
  loan: CollectableLoan | null;
  onClose: () => void;
  /** Called after the payment is saved (the sheet does not close itself). */
  onSaved: (amount: number) => void;
}

/** Record a Vasool payment. Shared by Loan Detail and the Dashboard's collection list. */
export function CollectPaymentSheet({ loan, onClose, onSaved }: CollectPaymentSheetProps) {
  return (
    <BottomSheet visible={loan !== null} onClose={onClose} title="Collect Payment (Vasool)">
      {/* Keyed + mounted only while open so every collection starts from fresh defaults. */}
      {loan && <PaymentForm key={loan.id} loan={loan} onSaved={onSaved} />}
    </BottomSheet>
  );
}

function PaymentForm({ loan, onSaved }: { loan: CollectableLoan; onSaved: (amount: number) => void }) {
  const balance = loan.balance_amount;
  const oneEmi = roundMoney(Math.min(loan.emi_amount, balance));
  const today = todayStr();
  // Payments can't predate disbursal; a loan disbursed "in the future" can only be paid from that day.
  const latestDate = loan.disbursal_date > today ? loan.disbursal_date : today;

  const [amountText, setAmountText] = useState(toInputString(oneEmi));
  const [chargesText, setChargesText] = useState('');
  const [date, setDate] = useState(latestDate);
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const amount = parseNumber(amountText);
  const chargesAmount = chargesText.trim() === '' ? 0 : Number(chargesText);
  const total = roundMoney(Math.max(0, amount) + Math.max(0, chargesAmount));

  let amountError: string | undefined;
  let chargesError: string | undefined;

  if (amount < 0 || !Number.isFinite(amount)) {
    amountError = 'Amount cannot be negative';
  } else if (roundMoney(amount) > balance) {
    amountError = `Cannot exceed the balance of ${formatCurrency(balance)}`;
  }

  if (chargesAmount < 0 || !Number.isFinite(chargesAmount)) {
    chargesError = 'Charges cannot be negative';
  }

  if (!amountError && !chargesError && amount === 0 && chargesAmount === 0) {
    amountError = 'Enter loan payment or extra charges';
  }

  const chips = [{ label: '1 EMI', value: oneEmi }];
  if (loan.emi_amount * 2 < balance) chips.push({ label: '2 EMIs', value: roundMoney(loan.emi_amount * 2) });
  if (balance > oneEmi) chips.push({ label: 'Full Balance', value: balance });

  const save = async () => {
    if (saving) return;
    setSubmitted(true);
    if (amountError || chargesError) return;
    setSaving(true);
    try {
      await addPayment({
        loan_id: loan.id,
        amount: roundMoney(amount),
        charges_amount: roundMoney(chargesAmount),
        payment_date: date,
        payment_mode: mode,
        notes,
      });
      scheduleAutoSync();
      onSaved(total);
    } catch (e) {
      setSaving(false);
      Alert.alert('Could not record payment', e instanceof Error ? e.message : String(e));
    }
  };

  const remaining = amountError ? null : roundMoney(Math.max(0, balance - amount));

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.info}>
        <View style={styles.infoTop}>
          <Text style={styles.customer}>
            {loan.customer_name}
          </Text>
          <View style={styles.tenureBadge}>
            <Text style={styles.tenureText}>{loan.tenure_type}</Text>
          </View>
        </View>
        <Text style={styles.infoMeta}>
          Loan #{loan.id} · {formatCurrency(loan.loan_amount)} over {formatTenure(loan.tenure_type, loan.period)} · EMI{' '}
          {formatCurrency(loan.emi_amount)}
        </Text>
        <View style={styles.infoStats}>
          <View style={styles.infoStat}>
            <Text style={styles.infoLabel}>Remaining balance</Text>
            <Text style={styles.infoValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{formatCurrency(balance)}</Text>
          </View>
          {loan.paid_today !== undefined && (
            <View style={styles.infoStat}>
              <Text style={styles.infoLabel}>Paid today</Text>
              <Text style={[styles.infoValue, loan.paid_today > 0 && styles.paid]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {formatCurrency(loan.paid_today)}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.chips}>
        {chips.map((chip) => {
          const selected = !amountError && roundMoney(amount) === chip.value;
          return (
            <Pressable
              key={chip.label}
              onPress={() => setAmountText(toInputString(chip.value))}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}>
              <Text style={[styles.chipLabel, selected && styles.chipTextSelected]}>{chip.label}</Text>
              <Text style={[styles.chipValue, selected && styles.chipTextSelected]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{formatCurrency(chip.value)}</Text>
            </Pressable>
          );
        })}
      </View>

      <FormField
        label="Amount (EMI / Loan)"
        prefix="₹"
        value={amountText}
        onChangeText={(t) => setAmountText(sanitizeDecimalInput(t))}
        keyboardType="decimal-pad"
        error={submitted ? amountError : undefined}
        hint={remaining !== null ? `Balance after this payment: ${formatCurrency(remaining)}` : undefined}
        selectTextOnFocus
      />

      <FormField
        label="Extra Charges / Penalty (₹)"
        prefix="₹"
        placeholder="0 (Optional)"
        value={chargesText}
        onChangeText={(t) => setChargesText(sanitizeDecimalInput(t))}
        keyboardType="decimal-pad"
        error={submitted ? chargesError : undefined}
        hint="Extra charges do not reduce the loan balance."
        selectTextOnFocus
      />

      <DateField
        label="Payment Date"
        required
        value={date}
        onChange={setDate}
        minimumDate={loan.disbursal_date}
        maximumDate={latestDate}
      />

      <View style={styles.field}>
        <Text style={styles.label}>Payment Mode</Text>
        <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} accessibilityLabel="Payment mode" />
      </View>

      <FormField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional, e.g. UPI ref no." />

      <AppButton
        label={amountError || chargesError || total === 0 ? 'Save Payment' : `Save ${formatCurrency(total)}`}
        icon="checkmark-circle"
        loading={saving}
        onPress={save}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: { gap: Spacing.lg, paddingBottom: Spacing.sm },
  info: { backgroundColor: Colors.navy, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs },
  infoTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  customer: { flex: 1, fontSize: 17, fontWeight: '800', color: Colors.textOnDark },
  tenureBadge: {
    backgroundColor: Colors.navyLight,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  tenureText: { fontSize: 12, fontWeight: '700', color: Colors.textOnDark },
  infoMeta: { fontSize: 12, color: Colors.tabInactive },
  infoStats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  infoStat: { flexBasis: '47%', flexGrow: 1, minWidth: 0 },
  infoLabel: { fontSize: 12, color: Colors.tabInactive },
  infoValue: { fontSize: 18, fontWeight: '800', color: Colors.textOnDark },
  paid: { color: Colors.emerald },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  chipSelected: { backgroundColor: Colors.emeraldDark, borderColor: Colors.emeraldDark },
  chipLabel: { fontSize: 12, fontWeight: '600', color: Colors.textMuted, textAlign: 'center' },
  chipValue: { fontSize: 14, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  chipTextSelected: { color: Colors.textOnDark },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text },
});
