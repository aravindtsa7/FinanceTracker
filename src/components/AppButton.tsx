import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'outline';

const VARIANTS: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: Colors.emeraldDark, fg: Colors.textOnDark, border: Colors.emeraldDark },
  secondary: { bg: Colors.navySoft, fg: Colors.navy, border: Colors.navySoft },
  danger: { bg: Colors.dangerSoft, fg: Colors.danger, border: Colors.dangerSoft },
  outline: { bg: Colors.card, fg: Colors.navy, border: Colors.border },
};

interface AppButtonProps {
  label: string;
  onPress: () => void;
  icon?: ComponentProps<typeof Ionicons>['name'];
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading = false,
  disabled = false,
  compact = false,
  style,
}: AppButtonProps) {
  const colors = VARIANTS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: colors.bg, borderColor: colors.border },
        (pressed || inactive) && styles.dimmed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.fg} />
      ) : (
        icon && <Ionicons name={icon} size={compact ? 16 : 18} color={colors.fg} />
      )}
      <Text style={[styles.label, compact && styles.labelCompact, { color: colors.fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    minHeight: 48,
    maxWidth: '100%',
  },
  compact: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, minHeight: 40 },
  dimmed: { opacity: 0.65 },
  label: { fontSize: 15, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  labelCompact: { fontSize: 14 },
});
