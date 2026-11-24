import { StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatCurrency, formatDate } from '@/utils/format';
import { paymentTimingLabel, roundMoney, type LoanEmiInstallment } from '@/utils/loanCalculations';

const STATUS_STYLE = {
  Paid: { color: Colors.emeraldDark, backgroundColor: Colors.emeraldSoft },
  Partial: { color: Colors.warning, backgroundColor: Colors.warningSoft },
  Overdue: { color: Colors.danger, backgroundColor: Colors.dangerSoft },
  Upcoming: { color: Colors.navyLight, backgroundColor: Colors.navySoft },
};

export function LoanEmiScheduleRow({ installment }: { installment: LoanEmiInstallment }) {
  const { installmentNumber, scheduledDate, expectedAmount, paidAmount, status, actualPaidDate, daysDiff } = installment;
  const color = daysDiff !== null && daysDiff > 0 ? Colors.warning : Colors.emeraldDark;
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.number}>#{installmentNumber}</Text>
        <Text style={styles.amount}>{formatCurrency(expectedAmount)}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_STYLE[status].backgroundColor }]}>
          <Text style={[styles.badgeText, { color: STATUS_STYLE[status].color }]}>{status}</Text>
        </View>
      </View>
      <Text style={styles.date}>Scheduled EMI Date: <Text style={styles.strong}>{formatDate(scheduledDate)}</Text></Text>
      {actualPaidDate && (
        <View style={styles.actualRow}>
          <Text style={styles.date}>Actual Paid Date: <Text style={styles.strong}>{formatDate(actualPaidDate)}</Text></Text>
          <View style={[styles.badge, { backgroundColor: daysDiff !== null && daysDiff > 0 ? Colors.warningSoft : Colors.emeraldSoft }]}>
            <Text style={[styles.badgeText, { color }]}>{daysDiff === 0 ? status === 'Partial' ? 'On time so far' : 'Paid on time' : paymentTimingLabel(daysDiff ?? 0)}</Text>
          </View>
        </View>
      )}
      {status === 'Partial' && (
        <Text style={styles.partial}>{formatCurrency(paidAmount)} paid · {formatCurrency(roundMoney(expectedAmount - paidAmount))} remaining. Date shown is the latest partial payment.</Text>
      )}
      {expectedAmount === 0 && <Text style={styles.date}>No amount due for this installment.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.md, gap: 6, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md },
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  number: { fontSize: 14, fontWeight: '800', color: Colors.navy },
  amount: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.text },
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  date: { fontSize: 12, color: Colors.textMuted },
  strong: { fontWeight: '700', color: Colors.text },
  actualRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  partial: { fontSize: 12, color: Colors.warning, lineHeight: 17 },
});
