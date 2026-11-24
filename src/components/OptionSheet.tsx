import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Colors, Radius, Spacing } from '@/constants/theme';

export interface SheetOption {
  key: string;
  label: string;
  description?: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color?: string;
  selected?: boolean;
  onPress: () => void;
}

interface OptionSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  options: SheetOption[];
}

/** A list of tappable actions in a bottom sheet (Android `Alert` is limited to three buttons). */
export function OptionSheet({ visible, onClose, title, subtitle, options }: OptionSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <View style={styles.list}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: !!option.selected }}
            onPress={() => {
              onClose();
              option.onPress();
            }}
            style={({ pressed }) => [styles.row, option.selected && styles.rowSelected, pressed && styles.pressed]}>
            <Ionicons name={option.icon} size={22} color={option.color ?? Colors.navyLight} />
            <View style={styles.text}>
              <Text style={[styles.label, option.color ? { color: option.color } : null]}>{option.label}</Text>
              {!!option.description && <Text style={styles.description}>{option.description}</Text>}
            </View>
            {option.selected && <Ionicons name="checkmark" size={20} color={Colors.emeraldDark} />}
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.lg,
  },
  rowSelected: { borderColor: Colors.emerald },
  pressed: { opacity: 0.7 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 15, fontWeight: '700', color: Colors.text },
  description: { fontSize: 13, color: Colors.textMuted },
});
