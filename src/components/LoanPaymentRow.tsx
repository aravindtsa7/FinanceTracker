import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Payment } from '@/types/finance';
import { formatCurrency, formatDate } from '@/utils/format';
import { paymentTimingLabel, roundMoney, type PaymentEmiMatch } from '@/utils/loanCalculations';

interface LoanPaymentRowProps {
  payment: Payment;
  matches: readonly PaymentEmiMatch[];
  disabled: boolean;
  onDelete: () => void;
}

export function LoanPaymentRow({ payment, matches, disabled, onDelete }: LoanPaymentRowProps) {
  const [expanded, setExpanded] = useState(false);
  const charges = payment.charges_amount ?? 0;
  const visibleMatches = expanded ? matches : matches.slice(0, 3);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.flex1}>
          <View style={styles.topLine}>
            <Text style={styles.amount}>{formatCurrency(roundMoney(payment.amount + charges))}</Text>
            <View style={[styles.mode, { backgroundColor: payment.payment_mode === 'UPI' ? Colors.navySoft : Colors.emeraldSoft }]}>
              <Text style={styles.modeText}>{payment.payment_mode}</Text>
            </View>
          </View>
          <Text style={styles.muted}>Paid: {formatDate(payment.payment_date)}</Text>
          {charges > 0 && <Text style={styles.charges}>{payment.amount > 0 ? `${formatCurrency(payment.amount)} EMI + ${formatCurrency(charges)} charges` : 'Charges only · no EMI settled'}</Text>}
        </View>
        <Pressable onPress={onDelete} disabled={disabled} accessibilityRole="button"
          accessibilityLabel={`Delete payment of ${formatCurrency(payment.amount + charges)} on ${formatDate(payment.payment_date)}`}
          style={({ pressed }) => [styles.delete, pressed && styles.pressed]}>
          <Ionicons name="trash-outline" size={18} color={Colors.danger} />
        </Pressable>
      </View>
      {visibleMatches.map((match) => (
        <View key={match.installmentNumber} style={styles.match}>
          <Text style={styles.matchTitle}>EMI #{match.installmentNumber} · {match.settlesInstallment ? 'Settled' : 'Partial'} {formatCurrency(match.amount)}</Text>
          <Text style={styles.muted}>Scheduled: {formatDate(match.scheduledDate)} · Paid: {formatDate(payment.payment_date)}</Text>
          <Text style={[styles.timing, { color: match.daysDiff > 0 ? Colors.warning : Colors.emeraldDark }]}>{paymentTimingLabel(match.daysDiff)}</Text>
        </View>
      ))}
      {matches.length > 3 && (
        <Pressable onPress={() => setExpanded((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded }} hitSlop={8}>
          <Text style={styles.link}>{expanded ? 'Show fewer matched EMIs' : `Show all ${matches.length} matched EMIs`}</Text>
        </Pressable>
      )}
      {!!payment.notes && <Text style={styles.notes}>{payment.notes}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  flex1: { flex: 1, minWidth: 0 },
  amount: { fontSize: 16, fontWeight: '800', color: Colors.text },
  mode: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  modeText: { fontSize: 11, fontWeight: '700', color: Colors.navyLight },
  muted: { fontSize: 12, color: Colors.textMuted },
  charges: { fontSize: 12, fontWeight: '600', color: '#7E22CE' },
  delete: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.dangerSoft },
  pressed: { opacity: 0.7 },
  match: { backgroundColor: Colors.background, borderRadius: 6, padding: Spacing.sm, gap: 2 },
  matchTitle: { fontSize: 12, fontWeight: '700', color: Colors.text },
  timing: { fontSize: 11, fontWeight: '600' },
  link: { fontSize: 12, fontWeight: '700', color: Colors.emeraldDark, paddingVertical: 6 },
  notes: { fontSize: 13, color: Colors.text },
});
