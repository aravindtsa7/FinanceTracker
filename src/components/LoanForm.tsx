import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { CustomerPickerSheet } from '@/components/CustomerPickerSheet';
import { DateField } from '@/components/DateField';
import { FormField } from '@/components/FormField';
import { FilterChips } from '@/components/FilterChips';
import { MultiPhotoPicker } from '@/components/MultiPhotoPicker';
import { SectionTitle } from '@/components/ScreenState';
import { SegmentedControl } from '@/components/SegmentedControl';
import { STATUS_COLORS } from '@/components/StatusBadge';
import { MONTHLY_LOAN_CATEGORIES } from '@/constants/loanCategories';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { addLoan, getCustomerById, updateLoan } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import type { Customer, InterestMode, Loan, LoanInput, LoanStatus, TenureType } from '@/types/finance';
import { isValidDateStr, todayStr } from '@/utils/date';
import { formatCurrency, formatDate } from '@/utils/format';
import { parseNumber, sanitizeDecimalInput, toInputString } from '@/utils/number';
import { isValidPhone } from '@/utils/phone';
import { parseUriList } from '@/utils/photoUris';

import {
  calculateLoanTerms,
  firstDefaultDueDate,
  interestFromRate,
  maturityDate,
  rateFromInterest,
  roundMoney,
} from '@/utils/loanCalculations';

const TENURE_OPTIONS = [
  { value: 'Daily', label: 'Daily' },
  { value: 'Weekly', label: 'Weekly' },
  { value: 'Monthly', label: 'Monthly' },
] as const;

const INTEREST_MODE_OPTIONS = [
  { value: 'AddToTotal', label: 'Add to Total' },
  { value: 'DeductUpfront', label: 'Deduct Upfront' },
] as const;

const INTEREST_MODE_HINTS: Record<InterestMode, string> = {
  AddToTotal: 'Standard — borrower repays principal + interest. Handover = principal − charges.',
  DeductUpfront: 'Piditham — interest is cut from the handover. Borrower repays the principal only.',
};

const STATUS_OPTIONS = (['Active', 'Overdue', 'Completed'] as const).map((s) => ({
  value: s,
  label: s,
  color: STATUS_COLORS[s].fg,
}));

const PERIOD_UNIT: Record<TenureType, { plural: string; per: string }> = {
  Daily: { plural: 'days', per: 'day' },
  Weekly: { plural: 'weeks', per: 'week' },
  Monthly: { plural: 'months', per: 'month' },
};

/** Which interest input the admin typed last; the other one is derived from it. */
type InterestSource = { field: 'rate' | 'amount'; text: string };

type Field = 'customer' | 'loanAmount' | 'period' | 'interest' | 'charges' | 'disbursal' | 'emi' | 'emiStartDate' | 'guarantorPhone';

const loadCustomer = (id: number | null) => (id ? getCustomerById(id) : Promise.resolve(null));

interface LoanFormProps {
  customerId?: number;
  initialLoan?: Loan;
  initialCustomer?: Customer;
}

export function LoanForm({ customerId, initialLoan, initialCustomer }: LoanFormProps) {
  const { pagePadding } = useResponsiveLayout();
  const paramId = customerId ?? null;
  const { data: paramCustomer, loading: loadingCustomer } = useDbQuery(loadCustomer, initialCustomer ? null : paramId);
  const insets = useSafeAreaInsets();

  const [picked, setPicked] = useState<Customer | null>(initialCustomer ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loanAmountText, setLoanAmountText] = useState(initialLoan ? toInputString(initialLoan.loan_amount) : '');
  const [tenure, setTenure] = useState<TenureType>(initialLoan?.tenure_type ?? 'Daily');
  const [monthlyType, setMonthlyType] = useState<string>(
    MONTHLY_LOAN_CATEGORIES.find((category) => category === initialLoan?.monthly_type) ?? 'Finance'
  );
  const [docUris, setDocUris] = useState(() => parseUriList(initialLoan?.doc_uris));
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [periodText, setPeriodText] = useState(initialLoan ? String(initialLoan.period) : '');
  const [interestMode, setInterestMode] = useState<InterestMode>(initialLoan?.interest_mode ?? 'AddToTotal');
  const [interest, setInterest] = useState<InterestSource>(initialLoan ? { field: 'amount', text: toInputString(initialLoan.interest_amount) } : { field: 'rate', text: '' });
  const [chargesText, setChargesText] = useState(initialLoan ? toInputString(initialLoan.charges) : '0');
  const [disbursalDate, setDisbursalDate] = useState(initialLoan?.disbursal_date ?? todayStr());
  const [emiStartOverride, setEmiStartOverride] = useState<string | null>(initialLoan?.emi_start_date ?? null);
  const emiStartDate = emiStartOverride ?? firstDefaultDueDate(disbursalDate, tenure);
  const [disbursalOverride, setDisbursalOverride] = useState<string | null>(() => {
    if (!initialLoan) return null;
    const auto = calculateLoanTerms(initialLoan.loan_amount, initialLoan.interest_amount, initialLoan.period, initialLoan.charges, initialLoan.interest_mode);
    return initialLoan.disbursal_amount === auto.disbursal_amount ? null : toInputString(initialLoan.disbursal_amount);
  });
  const [emiOverride, setEmiOverride] = useState<string | null>(() => {
    if (!initialLoan) return null;
    const auto = calculateLoanTerms(initialLoan.loan_amount, initialLoan.interest_amount, initialLoan.period, initialLoan.charges, initialLoan.interest_mode);
    return initialLoan.emi_amount === auto.emi_amount ? null : toInputString(initialLoan.emi_amount);
  });
  const [status, setStatus] = useState<LoanStatus>(initialLoan?.status ?? 'Active');
  const [guarantorName, setGuarantorName] = useState(initialLoan?.guarantor_name ?? '');
  const [guarantorPhone, setGuarantorPhone] = useState(initialLoan?.guarantor_phone ?? '');
  const [notes, setNotes] = useState(initialLoan?.notes ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const customer = picked ?? paramCustomer ?? null;

  // ---- Live calculation -------------------------------------------------
  const loanAmount = parseNumber(loanAmountText);
  const hasLoan = loanAmount > 0;
  const period = parseNumber(periodText);
  const hasPeriod = Number.isInteger(period) && period > 0;
  const charges = chargesText.trim() === '' ? 0 : parseNumber(chargesText);
  const interestValue = interest.text.trim() === '' ? 0 : parseNumber(interest.text);

  let rate: number;
  let interestAmount: number;
  if (interest.field === 'rate') {
    rate = interestValue;
    interestAmount = hasLoan ? interestFromRate(loanAmount, interestValue) : NaN;
  } else {
    interestAmount = roundMoney(interestValue);
    rate = initialLoan && loanAmount === initialLoan.loan_amount && interestAmount === initialLoan.interest_amount
      ? initialLoan.interest_rate : hasLoan ? rateFromInterest(loanAmount, interestValue) : NaN;
  }
  const showDerivedInterest = hasLoan && interest.text.trim() !== '' && Number.isFinite(interestValue);
  const rateText =
    interest.field === 'rate' ? interest.text : showDerivedInterest ? toInputString(rate, 4) : '';
  const interestAmountText =
    interest.field === 'amount' ? interest.text : showDerivedInterest ? toInputString(interestAmount) : '';

  const auto = calculateLoanTerms(
    hasLoan ? loanAmount : 0,
    Number.isFinite(interestAmount) ? interestAmount : 0,
    hasPeriod ? period : 0,
    Number.isFinite(charges) ? charges : 0,
    interestMode
  );
  const emi = emiOverride !== null ? parseNumber(emiOverride) : hasPeriod && hasLoan ? auto.emi_amount : NaN;
  // Preserve historical/overridden totals on a notes/status/date-only edit.
  const originalTermsUnchanged = initialLoan && loanAmount === initialLoan.loan_amount &&
    period === initialLoan.period && interestAmount === initialLoan.interest_amount &&
    interestMode === initialLoan.interest_mode && emi === initialLoan.emi_amount;
  const totalPayable = originalTermsUnchanged ? initialLoan.total_payable :
    emiOverride !== null && hasPeriod ? roundMoney(emi * period) : auto.total_payable;
  const disbursal = disbursalOverride !== null ? parseNumber(disbursalOverride) : auto.disbursal_amount;
  const lastInstallment = hasPeriod && emi > 0 ? roundMoney(totalPayable - emi * (period - 1)) : NaN;

  // ---- Validation -------------------------------------------------------
  const errors: Partial<Record<Field, string>> = {};
  if (!customer) errors.customer = 'Select a customer';
  if (!hasLoan) errors.loanAmount = 'Enter the loan amount';
  if (!hasPeriod) errors.period = `Enter the number of ${PERIOD_UNIT[tenure].plural} (whole number)`;
  if (!Number.isFinite(interestValue) || interestValue < 0) errors.interest = 'Enter a valid interest';
  if (!Number.isFinite(charges) || charges < 0) errors.charges = 'Enter valid charges (0 if none)';
  if (!isValidDateStr(emiStartDate) || emiStartDate < disbursalDate) {
    errors.emiStartDate = 'EMI start date must be on or after disbursal';
  }
  if (!(disbursal > 0)) errors.disbursal = 'Handover amount must be greater than zero';
  else if (hasLoan && disbursal > loanAmount) errors.disbursal = 'Handover cannot exceed the loan amount';
  if (!(emi > 0)) errors.emi = 'EMI must be greater than zero';
  else if (initialLoan && totalPayable < initialLoan.paid_amount) {
    errors.emi = `Total payable cannot be less than the amount already paid (${formatCurrency(initialLoan.paid_amount)})`;
  }
  if (guarantorPhone.trim() && !isValidPhone(guarantorPhone)) {
    errors.guarantorPhone = 'Enter a valid phone number (7–15 digits)';
  }
  const shownErrors = submitted ? errors : {};
  const errorCount = Object.keys(errors).length;

  // ---- Handlers ---------------------------------------------------------
  const openNewCustomer = () => {
    setPickerOpen(false);
    router.replace({ pathname: '/customer/form', params: { next: 'loan' } });
  };

  const save = async () => {
    if (saving || pickingPhoto) return;
    setSubmitted(true);
    if (errorCount > 0 || !customer) return;
    setSaving(true);
    try {
      const input: LoanInput = {
        customer_id: customer.id,
        loan_amount: roundMoney(loanAmount),
        tenure_type: tenure,
        monthly_type: tenure === 'Monthly' ? monthlyType : null,
        doc_uris: JSON.stringify(docUris),
        period,
        interest_rate: Number.isFinite(rate) ? rate : 0,
        interest_amount: interestAmount,
        interest_mode: interestMode,
        charges: roundMoney(charges),
        disbursal_date: disbursalDate,
        emi_start_date: emiStartOverride,
        disbursal_amount: roundMoney(disbursal),
        emi_amount: roundMoney(emi),
        total_payable: totalPayable,
        status,
        guarantor_name: guarantorName.trim(),
        guarantor_phone: guarantorPhone.trim(),
        notes,
      };
      if (initialLoan) {
        await updateLoan(initialLoan.id, input);
        router.back();
        return;
      }
      const id = await addLoan(input);
      router.replace({ pathname: '/loan/[id]', params: { id: String(id) } });
    } catch (e) {
      setSaving(false);
      Alert.alert('Could not save loan', e instanceof Error ? e.message : String(e));
    }
  };

  const unit = PERIOD_UNIT[tenure];
  const previewReady = hasLoan && hasPeriod && emi > 0;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 20}>
      <Stack.Title>{initialLoan ? 'Edit Loan' : 'New Loan'}</Stack.Title>
      <ScrollView
        ref={scrollViewRef}
        pointerEvents={saving ? 'none' : 'auto'}
        contentContainerStyle={[styles.content, { paddingHorizontal: pagePadding }]}
        keyboardShouldPersistTaps="handled">
        {/* Customer */}
        <SectionTitle>Borrower</SectionTitle>
        {customer ? (
          <View style={styles.customerCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{customer.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.flex1}>
              <Text style={styles.customerName}>{customer.name}</Text>
              <Text style={styles.muted}>{customer.phone}</Text>
            </View>
            {!initialLoan && (
              <Pressable onPress={() => setPickerOpen(true)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>Change</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <Pressable
            onPress={() => setPickerOpen(true)}
            disabled={!!paramId && loadingCustomer}
            accessibilityRole="button"
            style={[styles.selectCustomer, !!shownErrors.customer && styles.selectCustomerError]}>
            <Ionicons name="person-add-outline" size={20} color={Colors.navyLight} />
            <Text style={styles.selectCustomerText}>
              {paramId && loadingCustomer ? 'Loading customer…' : 'Select Customer'}
            </Text>
          </Pressable>
        )}
        {!!shownErrors.customer && <Text style={styles.error}>{shownErrors.customer}</Text>}

        {/* Loan terms */}
        <SectionTitle>Loan Terms</SectionTitle>
        <FormField
          label="Loan Amount (Principal)"
          required
          prefix="₹"
          value={loanAmountText}
          onChangeText={(t) => setLoanAmountText(sanitizeDecimalInput(t))}
          keyboardType="decimal-pad"
          placeholder="e.g. 10000"
          error={shownErrors.loanAmount}
        />

        <View style={styles.field}>
          <Text style={styles.label}>
            Tenure Type<Text style={styles.required}> *</Text>
          </Text>
          <SegmentedControl options={TENURE_OPTIONS} value={tenure} onChange={setTenure} accessibilityLabel="Tenure type" />
        </View>

        {tenure === 'Monthly' && (
          <FilterChips label="Monthly Loan Category" options={MONTHLY_LOAN_CATEGORIES}
            value={monthlyType} onChange={setMonthlyType} />
        )}

        <FormField
          label={`Period (Number of ${unit.plural})`}
          required
          suffix={unit.plural}
          value={periodText}
          onChangeText={(t) => setPeriodText(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder={tenure === 'Daily' ? 'e.g. 100' : tenure === 'Weekly' ? 'e.g. 12' : 'e.g. 10'}
          error={shownErrors.period}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Interest Mode</Text>
          <SegmentedControl
            options={INTEREST_MODE_OPTIONS}
            value={interestMode}
            onChange={setInterestMode}
            accessibilityLabel="Interest mode"
          />
          <Text style={styles.hint}>{INTEREST_MODE_HINTS[interestMode]}</Text>
        </View>

        <View style={styles.row}>
          <View style={styles.formColumn}>
            <FormField
              label="Interest Rate"
              suffix="%"
              value={rateText}
              onChangeText={(t) => setInterest({ field: 'rate', text: sanitizeDecimalInput(t) })}
              keyboardType="decimal-pad"
              placeholder="0"
              error={shownErrors.interest}
            />
          </View>
          <View style={styles.formColumn}>
            <FormField
              label="Interest Amount"
              prefix="₹"
              value={interestAmountText}
              onChangeText={(t) => setInterest({ field: 'amount', text: sanitizeDecimalInput(t) })}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>
        </View>

        <FormField
          label="Charges (Doc / Processing Fee)"
          prefix="₹"
          value={chargesText}
          onChangeText={(t) => setChargesText(sanitizeDecimalInput(t))}
          keyboardType="decimal-pad"
          selectTextOnFocus
          error={shownErrors.charges}
        />

        <DateField label="Disbursal Date" required value={disbursalDate} onChange={setDisbursalDate} />
        <View style={styles.field}>
          <DateField label="EMI Start Date" required value={emiStartDate} onChange={setEmiStartOverride}
            minimumDate={disbursalDate} error={shownErrors.emiStartDate} />
          {emiStartOverride !== null ? <OverrideBadge onReset={() => setEmiStartOverride(null)} /> :
            <Text style={styles.hint}>Automatically set to one period after disbursal.</Text>}
        </View>

        {/* Amounts */}
        <SectionTitle>Amounts</SectionTitle>
        <FormField
          label="Disbursal Amount (Handed Over)"
          required
          prefix="₹"
          value={disbursalOverride ?? (hasLoan ? toInputString(auto.disbursal_amount) : '')}
          onChangeText={(t) => setDisbursalOverride(sanitizeDecimalInput(t))}
          keyboardType="decimal-pad"
          placeholder="Calculated automatically"
          error={shownErrors.disbursal}
          labelRight={
            disbursalOverride !== null && (
              <OverrideBadge onReset={() => setDisbursalOverride(null)} />
            )
          }
        />
        <FormField
          label={`EMI Amount (Per ${unit.per})`}
          required
          prefix="₹"
          value={emiOverride ?? (hasLoan && hasPeriod ? toInputString(auto.emi_amount) : '')}
          onChangeText={(t) => setEmiOverride(sanitizeDecimalInput(t))}
          keyboardType="decimal-pad"
          placeholder="Calculated automatically"
          error={shownErrors.emi}
          hint={emiOverride !== null ? `Total payable becomes EMI × ${hasPeriod ? period : 'period'}` : undefined}
          labelRight={emiOverride !== null && <OverrideBadge onReset={() => setEmiOverride(null)} />}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Status</Text>
          <SegmentedControl options={STATUS_OPTIONS} value={status} onChange={setStatus} accessibilityLabel="Loan status" />
          {status !== 'Active' && (
            <Text style={styles.hint}>
              {status === 'Overdue'
                ? 'Overdue loans are listed first in today’s collections.'
                : 'Use Completed only for a loan that is already closed; no collections will be expected.'}
            </Text>
          )}
        </View>

        <MultiPhotoPicker label="Loan Documents / Collateral Photos" value={docUris} onChange={setDocUris}
          disabled={saving || pickingPhoto} onBusyChange={setPickingPhoto} />

        {/* Guarantor */}
        <SectionTitle>Guarantor (Jamin)</SectionTitle>
        <FormField
          label="Guarantor (Jamin) Name"
          value={guarantorName}
          onChangeText={setGuarantorName}
          placeholder="Optional"
          autoCapitalize="words"
        />
        <FormField
          label="Guarantor (Jamin) Phone"
          value={guarantorPhone}
          onChangeText={setGuarantorPhone}
          onFocus={() => {
            setTimeout(() => {
              scrollViewRef.current?.scrollToEnd({ animated: true });
            }, 150);
          }}
          placeholder="Optional"
          keyboardType="phone-pad"
          error={shownErrors.guarantorPhone}
        />

        <FormField
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          onFocus={() => {
            setTimeout(() => {
              scrollViewRef.current?.scrollToEnd({ animated: true });
            }, 150);
          }}
          multiline
          placeholder="Optional, e.g. purpose, collateral, agent"
        />

        {/* Summary */}
        <SectionTitle>Summary</SectionTitle>
        <View style={styles.summary}>
          <SummaryRow label="Handover amount" value={disbursal > 0 ? formatCurrency(disbursal) : '—'} strong />
          <SummaryRow label="Total payable" value={previewReady ? formatCurrency(totalPayable) : '—'} strong />
          <SummaryRow
            label={`EMI per ${unit.per}`}
            value={previewReady ? `${formatCurrency(emi)} × ${period}` : '—'}
          />
          {previewReady && lastInstallment > 0 && lastInstallment !== roundMoney(emi) && (
            <SummaryRow label="Last installment" value={formatCurrency(lastInstallment)} />
          )}
          {previewReady && disbursal > 0 && (
            <SummaryRow label="Your earning" value={formatCurrency(roundMoney(totalPayable - disbursal))} accent />
          )}
          <View style={styles.divider} />
          <SummaryRow
            label="First due date"
            value={hasPeriod ? formatDate(emiStartDate) : '—'}
          />
          <SummaryRow
            label="Final due date"
            value={hasPeriod ? formatDate(maturityDate(disbursalDate, tenure, period, emiStartDate)) : '—'}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingHorizontal: pagePadding }, { paddingBottom: Spacing.md + insets.bottom }]}>
        {submitted && errorCount > 0 && (
          <Text style={styles.footerError}>
            Please fix {errorCount === 1 ? 'the highlighted field' : `${errorCount} highlighted fields`}.
          </Text>
        )}
        <AppButton label={initialLoan ? 'Save Changes' : 'Save Loan'} icon="checkmark-circle" loading={saving}
          disabled={pickingPhoto} onPress={save} />
      </View>

      <CustomerPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedId={customer?.id}
        onSelect={(c) => {
          setPicked(c);
          setPickerOpen(false);
        }}
        onCreateNew={openNewCustomer}
      />
    </KeyboardAvoidingView>
  );
}

function OverrideBadge({ onReset }: { onReset: () => void }) {
  return (
    <View style={styles.overrideRow}>
      <View style={styles.editedBadge}>
        <Text style={styles.editedText}>Edited</Text>
      </View>
      <Pressable onPress={onReset} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reset to calculated value">
        <Text style={styles.link}>Reset</Text>
      </Pressable>
    </View>
  );
}

function SummaryRow({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, strong && styles.summaryStrong, accent && styles.summaryAccent]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1, minWidth: 0 },
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 160 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, alignItems: 'flex-start' },
  formColumn: { flexBasis: '47%', flexGrow: 1, minWidth: 136 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text },
  required: { color: Colors.danger },
  hint: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
  muted: { fontSize: 13, color: Colors.textMuted },
  error: { fontSize: 13, color: Colors.danger, fontWeight: '500', marginTop: -Spacing.sm },
  link: { fontSize: 14, fontWeight: '700', color: Colors.emeraldDark },
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.textOnDark, fontWeight: '700', fontSize: 16 },
  customerName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  selectCustomer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.navyLight,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.navySoft,
  },
  selectCustomerError: { borderColor: Colors.danger, backgroundColor: Colors.dangerSoft },
  selectCustomerText: { fontSize: 15, fontWeight: '700', color: Colors.navyLight },
  overrideRow: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: '100%', alignItems: 'center', gap: Spacing.sm },
  editedBadge: {
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  editedText: { fontSize: 11, fontWeight: '700', color: Colors.warning },
  summary: {
    backgroundColor: Colors.navy,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', columnGap: Spacing.md, rowGap: Spacing.xs },
  summaryLabel: { fontSize: 14, color: Colors.tabInactive, flexBasis: '42%', flexGrow: 1 },
  summaryValue: { fontSize: 14, fontWeight: '600', color: Colors.textOnDark, flexBasis: '48%', flexGrow: 1, textAlign: 'right' },
  summaryStrong: { fontSize: 17, fontWeight: '800' },
  summaryAccent: { color: Colors.emerald },
  divider: { height: 1, backgroundColor: Colors.navyLight, marginVertical: Spacing.xs },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  footerError: { color: Colors.danger, fontSize: 13, textAlign: 'center' },
});
