import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { CollectPaymentSheet } from '@/components/CollectPaymentSheet';
import { EmptyState } from '@/components/EmptyState';
import { LoanEmiScheduleRow } from '@/components/LoanEmiScheduleRow';
import { LoanPaymentRow } from '@/components/LoanPaymentRow';
import { LoanReminderNotes } from '@/components/LoanReminderNotes';
import { OptionSheet } from '@/components/OptionSheet';
import { PhotoGallery } from '@/components/PhotoGallery';
import { ErrorBanner, SectionTitle } from '@/components/ScreenState';
import { STATUS_COLORS, StatusBadge } from '@/components/StatusBadge';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { deleteLoan, deletePayment, getLoanById, getLoanReminders, getPaymentsByLoan, updateLoanStatus } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import type { Loan, LoanStatus, Payment } from '@/types/finance';
import { diffDays, todayStr } from '@/utils/date';
import { formatCurrency, formatDate, formatTenure } from '@/utils/format';
import { buildLoanEmiSchedule, installmentDate, installmentsElapsed, loanBalanceDue, loanTotalPaid, maturityDate, nextEmiDate, paidInstallments, paymentEmiMatches, roundMoney, type LoanEmiInstallment } from '@/utils/loanCalculations';
import { callNumber } from '@/utils/phone';
import { parseUriList } from '@/utils/photoUris';

async function loadLoan(id: number) {
  const [loan, payments, reminders] = await Promise.all([getLoanById(id), getPaymentsByLoan(id), getLoanReminders(id)]);
  return { loan, payments, reminders };
}

type DetailRow =
  | { key: string; kind: 'installment'; installment: LoanEmiInstallment }
  | { key: string; kind: 'ledger-header' | 'empty-payments' }
  | { key: string; kind: 'payment'; payment: Payment };

const STATUS_DESCRIPTIONS: Record<LoanStatus, string> = {
  Active: 'Collections in progress',
  Overdue: 'Flag as overdue — stays flagged until changed or fully paid',
  Completed: 'Close the loan, e.g. settled or waived',
};

const STATUS_ICONS = {
  Active: 'play-circle',
  Overdue: 'alert-circle',
  Completed: 'checkmark-done-circle',
} as const;

/** Repayment position as of today. */
function scheduleInfo(loan: Loan, today: string) {
  const elapsed = installmentsElapsed(loan.disbursal_date, loan.tenure_type, loan.period, today, loan.emi_start_date);
  const emisPaid = paidInstallments(loan);
  const expectedPaid = Math.min(loan.total_payable, elapsed * loan.emi_amount);
  const arrears = loan.balance_amount > 0 ? roundMoney(Math.max(0, expectedPaid - loan.paid_amount)) : 0;
  const nextDue = nextEmiDate(loan);
  return {
    elapsed,
    emisPaid: Math.min(emisPaid, loan.period),
    overdueEmis: Math.max(0, elapsed - emisPaid),
    arrears,
    arrearsEmis: loan.emi_amount > 0 ? Math.ceil(arrears / loan.emi_amount - 1e-9) : 0,
    nextDue,
    nextDueLate: nextDue !== null && diffDays(nextDue, today) > 0,
    firstDue: installmentDate(loan.disbursal_date, loan.tenure_type, 1, loan.emi_start_date),
    finalDue: maturityDate(loan.disbursal_date, loan.tenure_type, loan.period, loan.emi_start_date),
  };
}

export default function LoanDetailScreen() {
  const { pagePadding } = useResponsiveLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, reload } = useDbQuery(loadLoan, Number(id));
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const today = todayStr();
  const schedule = useMemo(() => data?.loan ? buildLoanEmiSchedule(data.loan, data.payments, today) : [], [data, today]);
  const matches = useMemo(() => paymentEmiMatches(schedule), [schedule]);
  // One virtualized list for both schedules and payments, including long daily loans.
  const rows = useMemo<DetailRow[]>(() => [
    ...(scheduleOpen ? schedule.map((installment): DetailRow => ({ key: `emi-${installment.installmentNumber}`, kind: 'installment', installment })) : []),
    { key: 'ledger-header', kind: 'ledger-header' },
    ...(data?.payments.length ? data.payments.map((payment): DetailRow => ({ key: `payment-${payment.id}`, kind: 'payment', payment })) :
      [{ key: 'empty-payments', kind: 'empty-payments' } as const]),
  ], [data, schedule, scheduleOpen]);

  if (!data) {
    return (
      <View style={styles.center}>
        {error ? <ErrorBanner error={error} /> : <ActivityIndicator size="large" color={Colors.emerald} />}
      </View>
    );
  }

  const { loan, payments, reminders } = data;
  if (!loan) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="alert-circle-outline"
          title="Loan not found"
          message="This loan may have been deleted."
          action={<AppButton label="Go back" variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  const info = scheduleInfo(loan, today);
  const balance = loanBalanceDue(loan);
  const totalPaid = loanTotalPaid(loan);
  const charges = loan.total_charges_collected ?? 0;
  const progress = loan.total_payable > 0 ? Math.min(1, loan.paid_amount / loan.total_payable) : 0;
  const statusColor = STATUS_COLORS[loan.status].fg;
  const documentPhotos = parseUriList(loan.doc_uris);

  const run = async (action: () => Promise<void>, failTitle: string) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      Alert.alert(failTitle, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (status: LoanStatus) => {
    if (status === loan.status) return;
    const apply = () => run(async () => {
      await updateLoanStatus(loan.id, status);
      await reload();
    }, 'Could not change status');
    if (status === 'Completed' && loan.balance_amount > 0) {
      Alert.alert(
        'Close with balance outstanding?',
        `${formatCurrency(loan.balance_amount)} is still unpaid. Mark this loan Completed anyway (e.g. settled or waived)?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Mark Completed', style: 'destructive', onPress: apply },
        ]
      );
    } else {
      apply();
    }
  };

  const confirmDeleteLoan = () => {
    const paymentsText = payments.length
      ? ` and its ${payments.length} payment record${payments.length === 1 ? '' : 's'} (${formatCurrency(totalPaid)} collected)`
      : '';
    Alert.alert(
      `Delete Loan #${loan.id}?`,
      `This permanently deletes ${loan.customer_name}'s ${formatCurrency(loan.loan_amount)} loan${paymentsText}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await deleteLoan(loan.id);
              router.back();
            }, 'Could not delete loan'),
        },
      ]
    );
  };

  const confirmDeletePayment = (payment: Payment) => {
    Alert.alert(
      'Delete this payment?',
      `${formatCurrency(roundMoney(payment.amount + (payment.charges_amount ?? 0)))} (${payment.payment_mode}) on ${formatDate(payment.payment_date)} will be removed. Balance due will increase by the EMI / loan portion: ${formatCurrency(payment.amount)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await deletePayment(payment.id);
              await reload();
            }, 'Could not delete payment'),
        },
      ]
    );
  };

  return (
    <>
      <Stack.Title>{`Loan #${loan.id}`}</Stack.Title>
      <FlatList<DetailRow>
        style={styles.screen}
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingHorizontal: pagePadding }]}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
        ListHeaderComponent={<View style={styles.headerContent}>
        <ErrorBanner error={error} />

        {/* Customer banner */}
        <View style={styles.banner}>
          <Pressable
            style={styles.bannerText}
            onPress={() => router.push({ pathname: '/customer/[id]', params: { id: String(loan.customer_id) } })}
            accessibilityRole="link"
            accessibilityLabel={`Open ${loan.customer_name}'s profile`}>
            <View style={styles.bannerNameRow}>
              <Text style={styles.bannerName}>
                {loan.customer_name}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.tabInactive} />
            </View>
            <Text style={styles.bannerPhone}>{loan.customer_phone || 'No phone'}</Text>
          </Pressable>
          {!!loan.customer_phone && (
            <Pressable
              onPress={() => callNumber(loan.customer_phone)}
              style={({ pressed }) => [styles.callButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Call ${loan.customer_name}`}>
              <Ionicons name="call" size={20} color={Colors.textOnDark} />
            </Pressable>
          )}
        </View>

        <LoanReminderNotes key={loan.id} loanId={loan.id} notes={reminders} onChanged={reload} />

        {/* Progress */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <StatusBadge status={loan.status} />
            <View style={styles.headerActions}>
              <AppButton label="Status" icon="swap-horizontal" variant="outline" compact onPress={() => setStatusOpen(true)} />
              <Pressable
                onPress={confirmDeleteLoan}
                disabled={busy}
                hitSlop={6}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Delete loan">
                <Ionicons name="trash-outline" size={20} color={Colors.danger} />
              </Pressable>
            </View>
          </View>

          <View>
            <Text style={styles.muted}>Balance Due</Text>
            <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{formatCurrency(balance)}</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: statusColor }]} />
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.muted}>
              Total Paid <Text style={styles.paid}>{formatCurrency(totalPaid)}</Text>
            </Text>
            <Text style={styles.muted}>
              EMI repaid: <Text style={styles.strong}>{formatCurrency(loan.paid_amount)}</Text> / {formatCurrency(loan.total_payable)} ({Math.round(progress * 100)}%)
            </Text>
          </View>
          {charges > 0 && <Text style={styles.ledgerChargesTotal}>Includes {formatCurrency(charges)} extra charges; charges do not reduce Balance Due.</Text>}

          <View style={styles.statsRow}>
            <MiniStat label="EMI Paid" value={
              <>
                <Text style={{ color: Colors.emeraldDark }}>{info.emisPaid}</Text>
                {info.overdueEmis > 0 && <Text style={{ color: Colors.danger }}>{` + ${info.overdueEmis}`}</Text>}
                {` / ${loan.period}`}
              </>
            } />
            <MiniStat
              label="Next due"
              value={info.nextDue ? formatDate(info.nextDue) : '—'}
              color={info.nextDueLate ? Colors.danger : undefined}
            />
            <MiniStat label="Final due" value={formatDate(info.finalDue)} />
          </View>

          {loan.balance_amount > 0 &&
            (info.arrears > 0 ? (
              <View style={[styles.notice, styles.noticeDanger]}>
                <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                <Text style={[styles.noticeText, { color: Colors.danger }]}>
                  Behind by {formatCurrency(info.arrears)} (≈{info.arrearsEmis} EMI{info.arrearsEmis === 1 ? '' : 's'}) —{' '}
                  {info.elapsed} of {loan.period} installments have fallen due
                </Text>
              </View>
            ) : (
              <View style={[styles.notice, styles.noticeOk]}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.emeraldDark} />
                <Text style={[styles.noticeText, { color: Colors.emeraldDark }]}>
                  On track — {info.elapsed} of {loan.period} installments due so far
                </Text>
              </View>
            ))}
        </View>

        {loan.balance_amount > 0 && (
          <AppButton
            label="Collect Payment (Vasool)"
            icon="add-circle"
            onPress={() => setPaymentOpen(true)}
            style={styles.collect}
          />
        )}

        <AppButton
          label="Edit Loan"
          icon="create-outline"
          variant="secondary"
          disabled={busy}
          onPress={() => router.push({ pathname: '/loan/edit', params: { id: String(loan.id) } })}
        />

        {(!!loan.guarantor_name || !!loan.guarantor_phone) && (
          <View style={[styles.card, styles.guarantorCard]}>
            <View style={styles.guarantorHeader}>
              <Ionicons name="shield-checkmark" size={18} color={Colors.warning} />
              <Text style={styles.guarantorTitle}>Guarantor (Jamin)</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={18} color={Colors.navyLight} style={styles.infoIcon} />
              <View style={styles.infoText}>
                <Text style={styles.miniLabel}>Guarantor Name</Text>
                <Text style={styles.infoValue}>{loan.guarantor_name || '—'}</Text>
              </View>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="call-outline" size={18} color={Colors.navyLight} style={styles.infoIcon} />
              <View style={styles.infoText}>
                <Text style={styles.miniLabel}>Guarantor Phone</Text>
                <Text style={styles.infoValue}>{loan.guarantor_phone || '—'}</Text>
              </View>
            </View>
            {!!loan.guarantor_phone && (
              <AppButton
                label="Call Guarantor"
                icon="call"
                variant="outline"
                compact
                onPress={() => callNumber(loan.guarantor_phone)}
              />
            )}
          </View>
        )}

        {/* Breakdown */}
        <SectionTitle>Loan Details</SectionTitle>
        <View style={[styles.card, styles.grid]}>
          <GridItem label="Loan amount" value={formatCurrency(loan.loan_amount)} />
          <GridItem
            label={`Interest (${loan.interest_mode === 'DeductUpfront' ? 'deducted upfront' : 'added to total'})`}
            value={`${formatCurrency(loan.interest_amount)} · ${Number(loan.interest_rate.toFixed(2))}%`}
          />
          <GridItem label="Charges" value={formatCurrency(loan.charges)} />
          {(loan.total_charges_collected ?? 0) > 0 && (
            <GridItem label="Extra Charges Collected" value={formatCurrency(loan.total_charges_collected!)} />
          )}
          <GridItem label="Handed over" value={formatCurrency(loan.disbursal_amount)} />
          <GridItem label="Disbursal date" value={formatDate(loan.disbursal_date)} />
          {(loan.status === 'Completed' || !!loan.closed_date) && (
            <GridItem label="Closed Date" value={loan.closed_date ? formatDate(loan.closed_date) : 'Completed'} />
          )}
          <GridItem label="Tenure" value={`${loan.tenure_type} · ${formatTenure(loan.tenure_type, loan.period)}`} />
          {loan.tenure_type === 'Monthly' && !!loan.monthly_type && (
            <GridItem label="Monthly Loan Category" value={loan.monthly_type} />
          )}
          <GridItem label="EMI amount" value={formatCurrency(loan.emi_amount)} />
          <GridItem label="Total payable" value={formatCurrency(loan.total_payable)} />
          <GridItem label="Total Paid" value={formatCurrency(totalPaid)} />
          <GridItem label="First due" value={formatDate(info.firstDue)} />
          <GridItem label="Final due" value={formatDate(info.finalDue)} />
          {!!loan.notes && <GridItem label="Notes" value={loan.notes} full />}
        </View>

        {documentPhotos.length > 0 && (
          <View style={styles.card}>
            <SectionTitle>Loan Documents / Collateral Photos</SectionTitle>
            <PhotoGallery label="Loan Documents / Collateral Photos" uris={documentPhotos} />
          </View>
        )}

        <Pressable onPress={() => setScheduleOpen((value) => !value)} accessibilityRole="button"
          accessibilityLabel="EMI Schedule (All Installments)" accessibilityState={{ expanded: scheduleOpen }}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionLabel}>EMI Schedule (All Installments)</Text>
            <Ionicons name={scheduleOpen ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.navyLight} />
          </View>
          <Text style={styles.muted}>{schedule.length} installments · {scheduleOpen ? 'Tap to collapse' : 'Tap to view scheduled and actual dates'}</Text>
          {loan.status === 'Completed' && balance > 0 && <Text style={styles.muted}>This loan was closed with an outstanding balance. Only recorded payments mark installments Paid.</Text>}
        </Pressable>
        </View>}
        renderItem={({ item }) => {
          if (item.kind === 'installment') return <LoanEmiScheduleRow installment={item.installment} />;
          if (item.kind === 'payment') return <LoanPaymentRow key={item.payment.id} payment={item.payment}
            matches={matches.get(item.payment.id) ?? []} disabled={busy} onDelete={() => confirmDeletePayment(item.payment)} />;
          if (item.kind === 'empty-payments') return <EmptyState icon="receipt-outline" title="No payments yet" message="Collections you record will appear here." />;
          return (
            <View style={styles.ledgerHeader}>
              <SectionTitle>{`Payment History (Vasool Ledger) · ${payments.length}`}</SectionTitle>
              <Text style={styles.ledgerTotal}>Total Paid {formatCurrency(totalPaid)}</Text>
              {charges > 0 && <Text style={styles.ledgerChargesTotal}>Includes {formatCurrency(charges)} charges</Text>}
            </View>
          );
        }}
      />

      <CollectPaymentSheet
        loan={paymentOpen ? loan : null}
        onClose={() => setPaymentOpen(false)}
        onSaved={() => {
          setPaymentOpen(false);
          void reload();
        }}
      />

      <OptionSheet
        visible={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Change Status"
        subtitle={`Loan #${loan.id} · ${loan.customer_name}`}
        options={(['Active', 'Overdue', 'Completed'] as const).map((s) => ({
          key: s,
          label: s,
          description: STATUS_DESCRIPTIONS[s],
          icon: STATUS_ICONS[s],
          color: STATUS_COLORS[s].fg,
          selected: s === loan.status,
          onPress: () => changeStatus(s),
        }))}
      />
    </>
  );
}

function MiniStat({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={[styles.miniValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
    </View>
  );
}

function GridItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <View style={[styles.gridItem, full && styles.gridItemFull]}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.gridValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl * 2 },
  headerContent: { gap: Spacing.md },
  sectionLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  ledgerHeader: { gap: 4 },
  flex1: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  muted: { fontSize: 13, color: Colors.textMuted },
  strong: { fontWeight: '700', color: Colors.text },
  paid: { fontWeight: '700', color: Colors.emeraldDark },
  rowBetween: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'center', justifyContent: 'space-between' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.navy,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  bannerText: { flex: 1, minWidth: 0 },
  bannerNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  bannerName: { fontSize: 18, fontWeight: '800', color: Colors.textOnDark, flexShrink: 1 },
  bannerPhone: { fontSize: 14, color: Colors.tabInactive, marginTop: 2 },
  callButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.emeraldDark,
    alignItems: 'center',
    justifyContent: 'center',
  },

  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  cardHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dangerSoft,
  },
  balance: { fontSize: 30, fontWeight: '800', color: Colors.text },
  track: { height: 10, borderRadius: 5, backgroundColor: Colors.navySoft, overflow: 'hidden' },
  fill: { height: '100%' },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  miniStat: { flexBasis: '47%', flexGrow: 1, minWidth: 0, backgroundColor: Colors.navySoft, borderRadius: Radius.md, padding: Spacing.sm, gap: 4 },
  miniLabel: { fontSize: 12, color: Colors.textMuted },
  miniValue: { fontSize: 14, fontWeight: '700', color: Colors.text },
  notice: { flexDirection: 'row', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  noticeDanger: { backgroundColor: Colors.dangerSoft },
  noticeOk: { backgroundColor: Colors.emeraldSoft },
  noticeText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  collect: { minHeight: 56 },
  guarantorCard: { backgroundColor: Colors.warningSoft, borderColor: '#FDE68A' },
  guarantorHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  guarantorTitle: { fontSize: 15, fontWeight: '700', color: Colors.warning },
  infoRow: { flexDirection: 'row', gap: Spacing.md },
  infoIcon: { marginTop: 2 },
  infoText: { flex: 1, minWidth: 0 },
  infoValue: { fontSize: 15, color: Colors.text, lineHeight: 21 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.lg, columnGap: Spacing.md },
  gridItem: { flexBasis: '47%', flexGrow: 1, minWidth: 0, gap: 4 },
  gridItemFull: { flexBasis: '100%' },
  gridValue: { fontSize: 15, fontWeight: '600', color: Colors.text },

  ledgerTotal: { fontSize: 14, fontWeight: '800', color: Colors.emeraldDark, marginTop: Spacing.sm },
  ledgerChargesTotal: { fontSize: 12, fontWeight: '700', color: '#7E22CE' },
});
