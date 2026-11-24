import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { STATUS_COLORS, StatusBadge } from '@/components/StatusBadge';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Loan } from '@/types/finance';
import { todayStr } from '@/utils/date';
import { formatCurrency, formatDate, formatTenure } from '@/utils/format';
import { loanBalanceDue, loanTotalPaid, nextEmiDate } from '@/utils/loanCalculations';
import { callNumber } from '@/utils/phone';

interface LoanCardProps {
  loan: Loan;
  onPress?: () => void;
  /** Show the borrower's name (useful in lists that mix customers). */
  showCustomer?: boolean;
}

export function LoanCard({ loan, onPress, showCustomer = false }: LoanCardProps) {
  const progress = loan.total_payable > 0 ? Math.min(1, Math.max(0, loan.paid_amount / loan.total_payable)) : 0;
  const isCompleted = loan.status === 'Completed';
  const nextDue = loan.next_due_date ?? nextEmiDate(loan);
  const isLate = nextDue !== null && nextDue < todayStr();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`Loan ${loan.id}, ${loan.customer_name}, ${formatCurrency(loan.loan_amount)}, ${loan.status}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {/* Line 1: Customer Name + 1-tap Call Button + Status Badge */}
      <View style={styles.topLine}>
        <View style={styles.nameRow}>
          <Text style={styles.customerName} numberOfLines={1}>
            {showCustomer ? loan.customer_name : `Loan #${loan.id}`}
          </Text>
          {showCustomer && <Text style={styles.loanId}>#{loan.id}</Text>}
        </View>
        <View style={styles.actionsRow}>
          {!!loan.customer_phone && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                callNumber(loan.customer_phone);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Call ${loan.customer_name}`}
              style={({ pressed: btnPressed }) => [styles.callBtn, btnPressed && styles.pressed]}>
              <Ionicons name="call" size={12} color={Colors.emeraldDark} />
            </Pressable>
          )}
          <StatusBadge status={loan.status} />
        </View>
      </View>

      {/* Line 2: Loan Amount + Tenure/EMI/Jamin/Charges Pills */}
      <View style={styles.pillsRow}>
        <Text style={styles.amount}>{formatCurrency(loan.loan_amount)}</Text>
        <View style={styles.pillGroup}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>
              {loan.tenure_type}{loan.tenure_type === 'Monthly' && loan.monthly_type ? ` · ${loan.monthly_type}` : ''} · {formatTenure(loan.tenure_type, loan.period)}
            </Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>EMI {formatCurrency(loan.emi_amount)}</Text>
          </View>
          {!!loan.guarantor_name && (
            <View style={[styles.pill, styles.jaminPill]}>
              <Ionicons name="shield-checkmark" size={11} color={Colors.warning} />
              <Text style={styles.jaminPillText} numberOfLines={1}>
                {loan.guarantor_name}
              </Text>
            </View>
          )}
          {(loan.total_charges_collected ?? 0) > 0 && (
            <View style={[styles.pill, styles.chargesPill]}>
              <Ionicons name="receipt-outline" size={11} color="#7E22CE" />
              <Text style={styles.chargesPillText}>
                Incl. {formatCurrency(loan.total_charges_collected!)} charges
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Line 3: Slim Progress Bar */}
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: STATUS_COLORS[loan.status].fg }]}
        />
      </View>

      {/* Line 4: Paid vs Balance Due Row (+ next due date / closed date) */}
      <View style={styles.bottomRow}>
        <Text style={styles.meta}>
          Total Paid <Text style={styles.paid}>{formatCurrency(loanTotalPaid(loan))}</Text>
        </Text>
        {isCompleted ? (
          <Text style={styles.meta}>
            <Text style={styles.closedText}>
              Closed: {loan.closed_date ? formatDate(loan.closed_date) : 'Completed'}
            </Text>
          </Text>
        ) : (
          <Text style={styles.meta}>
            Next Due <Text style={[styles.dueText, isLate && styles.lateText]}>{nextDue ? formatDate(nextDue) : '—'}</Text>
          </Text>
        )}
        <Text style={styles.meta}>
          Balance <Text style={styles.balance}>{formatCurrency(loanBalanceDue(loan))}</Text>
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    gap: 6,
  },
  pressed: { opacity: 0.75 },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  nameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    flexShrink: 1,
  },
  loanId: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  callBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.emeraldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  amount: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.navy,
  },
  pillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  pill: {
    backgroundColor: Colors.navySoft,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.navyLight,
  },
  jaminPill: {
    backgroundColor: Colors.warningSoft,
  },
  jaminPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.warning,
    maxWidth: 90,
  },
  chargesPill: {
    backgroundColor: '#F3E8FF',
  },
  chargesPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7E22CE',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.navySoft,
    overflow: 'hidden',
  },
  fill: { height: '100%' },
  bottomRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.sm,
    rowGap: 2,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: { fontSize: 12, color: Colors.textMuted },
  paid: { fontWeight: '700', color: Colors.emeraldDark },
  balance: { fontWeight: '700', color: Colors.text },
  dueText: { fontWeight: '600', color: Colors.textMuted },
  lateText: { color: Colors.danger, fontWeight: '700' },
  closedText: { fontWeight: '700', color: Colors.emeraldDark },
});
