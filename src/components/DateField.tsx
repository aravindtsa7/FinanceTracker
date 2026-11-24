import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { todayStr } from '@/utils/date';
import { formatDate } from '@/utils/format';

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` → local-midnight Date (what the native picker expects). */
function toDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface DateFieldProps {
  label: string;
  /** `YYYY-MM-DD` */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minimumDate?: string;
  maximumDate?: string;
  error?: string;
  placeholder?: string;
}

/**
 * Tappable date trigger. Android opens the native dialog imperatively;
 * iOS toggles an inline calendar below the trigger.
 */
export function DateField({ label, value, onChange, required, minimumDate, maximumDate, error, placeholder = 'Select date' }: DateFieldProps) {
  const [iosOpen, setIosOpen] = useState(false);
  const min = minimumDate ? toDate(minimumDate) : undefined;
  const max = maximumDate ? toDate(maximumDate) : undefined;

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: toDate(value || todayStr()),
        mode: 'date',
        minimumDate: min,
        maximumDate: max,
        onValueChange: (_event, date) => onChange(toDateStr(date)),
      });
    } else {
      setIosOpen((v) => !v);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatDate(value) : placeholder}. Tap to change`}
        style={({ pressed }) => [styles.trigger, !!error && styles.triggerError, pressed && styles.pressed]}>
        <Ionicons name="calendar" size={18} color={Colors.navyLight} />
        <Text style={styles.value}>{value ? formatDate(value) : placeholder}</Text>
        <Ionicons name={iosOpen ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textMuted} />
      </Pressable>
      {iosOpen && Platform.OS !== 'android' && (
        <DateTimePicker
          value={toDate(value || todayStr())}
          mode="date"
          display="inline"
          minimumDate={min}
          maximumDate={max}
          accentColor={Colors.emeraldDark}
          onValueChange={(_event, date) => {
            onChange(toDateStr(date));
            setIosOpen(false);
          }}
        />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text },
  required: { color: Colors.danger },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
    paddingVertical: Spacing.sm,
  },
  triggerError: { borderColor: Colors.danger, backgroundColor: Colors.dangerSoft },
  pressed: { opacity: 0.7 },
  value: { flex: 1, fontSize: 16, color: Colors.text, fontWeight: '500' },
  error: { fontSize: 13, color: Colors.danger, fontWeight: '500' },
});
