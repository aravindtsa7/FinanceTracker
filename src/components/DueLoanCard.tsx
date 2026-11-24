import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { StatusBadge } from '@/components/StatusBadge';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { DueLoan } from '@/types/finance';
import { formatCurrency } from '@/utils/format';
import { loanBalanceDue, loanTotalPaid, roundMoney } from '@/utils/loanCalculations';
import { callNumber } from '@/utils/phone';

interface DueLoanCardProps {
  loan: DueLoan;
  onPress: () => void;
  onCollect: () => void;
}

/** A compact collection card with the same hierarchy as the Loans page. */
export function DueLoanCard({ loan, onPress, onCollect }: DueLoanCardProps) {
  const balance = loanBalanceDue(loan);
  const collectedInFull = loan.paid_today >= loan.due_today || balance <= 0;
  const chargesToday = loan.charges_today ?? 0;
  const paidToday = roundMoney(loan.paid_today + chargesToday);
  const charges = loan.total_charges_collected ?? 0;

  return (
    <View style={[styles.card, loan.is_overdue && styles.overdue]}>
      <Pressable onPress={onPress} accessibilityRole="button"
        accessibilityLabel={`${loan.customer_name}, target ${formatCurrency(loan.due_today)}, collected today ${formatCurrency(paidToday)}, EMI paid today ${formatCurrency(loan.paid_today)}`}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <View style={styles.topLine}>
          <Text style={styles.name} numberOfLines={1}>{loan.customer_name}</Text>
          <Text style={styles.loanId}>#{loan.id}</Text>
          {!!loan.customer_phone && (
            <Pressable onPress={(event) => { event.stopPropagation(); callNumber(loan.customer_phone); }}
              hitSlop={8} accessibilityRole="button" accessibilityLabel={`Call ${loan.customer_name}`}
              style={({ pressed }) => [styles.callButton, pressed && styles.pressed]}>
              <Ionicons name="call" size={13} color={Colors.emeraldDark} />
            </Pressable>
          )}
          <StatusBadge status={loan.is_overdue && loan.status !== 'Completed' ? 'Overdue' : loan.status} />
        </View>
        <View style={styles.pills}>
          <Pill text={loan.tenure_type} />
          <Pill text={`EMI ${formatCurrency(loan.emi_amount)}`} />
          {loan.installment_number !== null && <Pill text={`#${loan.installment_number}/${loan.period}`} />}
          {collectedInFull && <Pill text="Collected" collected />}
        </View>
        <View style={styles.stats}>
          <Stat label="Today's target" value={formatCurrency(loan.due_today)} />
          <Stat label="Paid Today" value={formatCurrency(paidToday)} color={collectedInFull ? Colors.emeraldDark : Colors.warning} />
          <Stat label="Balance Due" value={formatCurrency(balance)} />
        </View>
        {chargesToday > 0 && <Text style={styles.charges}>Today: {formatCurrency(loan.paid_today)} EMI + {formatCurrency(chargesToday)} charges</Text>}
      </Pressable>
      <View style={styles.footer}>
        <View style={styles.flex1}>
          <Text style={styles.total}>Total Paid <Text style={styles.paid}>{formatCurrency(loanTotalPaid(loan))}</Text></Text>
          {charges > 0 && <Text style={styles.charges}>Incl. {formatCurrency(charges)} charges</Text>}
        </View>
        {balance > 0 && <AppButton label={collectedInFull ? 'Collect More' : 'Collect'} icon="cash-outline"
          compact variant={collectedInFull ? 'outline' : 'primary'} onPress={onCollect} />}
      </View>
    </View>
  );
}

function Pill({ text, collected }: { text: string; collected?: boolean }) {
  return <View style={[styles.pill, collected && styles.collectedPill]}><Text style={[styles.pillText, collected && styles.paid]}>{text}</Text></View>;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2, gap: 8 },
  overdue: { borderLeftWidth: 3, borderLeftColor: Colors.danger },
  body: { gap: 6 },
  pressed: { opacity: 0.75 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: Colors.text },
  loanId: { fontSize: 12, color: Colors.textMuted },
  callButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.emeraldSoft, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  pill: { backgroundColor: Colors.navySoft, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  collectedPill: { backgroundColor: Colors.emeraldSoft },
  pillText: { fontSize: 11, fontWeight: '600', color: Colors.navyLight },
  stats: { flexDirection: 'row', gap: Spacing.xs },
  stat: { flex: 1, minWidth: 0, gap: 2 },
  statLabel: { fontSize: 11, color: Colors.textMuted },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.text },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  flex1: { flex: 1, minWidth: 100 },
  total: { fontSize: 12, color: Colors.textMuted },
  paid: { color: Colors.emeraldDark, fontWeight: '700' },
  charges: { fontSize: 11, color: '#7E22CE', fontWeight: '600' },
});
