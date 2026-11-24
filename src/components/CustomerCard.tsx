import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { CustomerWithSummary } from '@/types/finance';
import { formatCurrency } from '@/utils/format';
import { callNumber } from '@/utils/phone';

interface CustomerCardProps {
  customer: CustomerWithSummary;
  onPress: () => void;
}

export function CustomerCard({ customer, onPress }: CustomerCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${customer.name}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <CustomerAvatar name={customer.name} uri={customer.photo_uri} size={44} />

      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{customer.name}</Text>
          {!!customer.kyc_type && (
            <View style={styles.kycPill}>
              <Text style={styles.kycText} numberOfLines={1}>{customer.kyc_type}</Text>
            </View>
          )}
        </View>
        <View style={styles.line}>
          <Ionicons name="call-outline" size={13} color={Colors.textMuted} />
          <Text style={styles.meta} numberOfLines={1}>
            {customer.phone || 'No phone'}
          </Text>
          {!!customer.alternate_phone && (
            <View style={styles.alternatePill} accessible accessibilityLabel={`Alternate phone: ${customer.alternate_phone}`}>
              <Ionicons name="call-outline" size={10} color={Colors.emeraldDark} />
              <Text style={styles.alternateText}>Alt</Text>
            </View>
          )}
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>{customer.active_loans} active {customer.active_loans === 1 ? 'loan' : 'loans'}</Text>
          <Text style={styles.balance} numberOfLines={1}>{formatCurrency(customer.balance_due)} due</Text>
        </View>
      </View>

      {!!customer.phone && (
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            callNumber(customer.phone);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Call ${customer.name}`}
          style={({ pressed }) => [styles.callButton, pressed && styles.pressed]}>
          <Ionicons name="call" size={18} color={Colors.emeraldDark} />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  pressed: { opacity: 0.7 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: Colors.text },
  kycPill: { maxWidth: 80, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: Colors.navySoft },
  kycText: { fontSize: 10, fontWeight: '600', color: Colors.navyLight },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  meta: { flexShrink: 1, fontSize: 12, color: Colors.textMuted },
  alternatePill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, backgroundColor: Colors.emeraldSoft },
  alternateText: { fontSize: 10, fontWeight: '600', color: Colors.emeraldDark },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.sm, rowGap: 2 },
  summaryText: { fontSize: 11, color: Colors.textMuted },
  balance: { flexShrink: 1, fontSize: 11, fontWeight: '700', color: Colors.emeraldDark },
  callButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.emeraldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
