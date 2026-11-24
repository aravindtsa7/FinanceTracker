import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface StatCardProps {
  label: string;
  value: string | number;
  icon: IconName;
  accent?: string;
  compact?: boolean;
  /** Makes the card tappable and shows a chevron. */
  onPress?: () => void;
}

export function StatCard({ label, value, icon, accent = Colors.emerald, compact = false, onPress }: StatCardProps) {
  const { cardPadding, metricFontSize } = useResponsiveLayout();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [
        styles.card,
        compact ? styles.cardCompact : { padding: cardPadding },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.top, compact && styles.topCompact]}>
        <View style={[styles.iconWrap, compact && styles.iconWrapCompact, { backgroundColor: `${accent}1A` }]}>
          <Ionicons name={icon} size={compact ? 16 : 20} color={accent} />
        </View>
        {onPress && <Ionicons name="chevron-forward" size={compact ? 14 : 16} color={Colors.textMuted} />}
      </View>
      <Text style={[styles.value, { fontSize: compact ? 15 : metricFontSize }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  cardCompact: {
    padding: Spacing.sm,
    gap: 2,
  },
  pressed: { opacity: 0.7 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.xs },
  topCompact: { marginBottom: 2 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  label: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  labelCompact: {
    fontSize: 11,
  },
});
