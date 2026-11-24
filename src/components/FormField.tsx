import type { ReactNode, Ref } from 'react';
import { StyleSheet, View, type TextInput, type TextInputProps } from 'react-native';

import { AppText as Text, AppTextInput } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';

interface FormFieldProps extends TextInputProps {
  ref?: Ref<TextInput>;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  /** Shown inside the box before the text, e.g. `₹`. */
  prefix?: string;
  /** Shown inside the box after the text, e.g. `%` or `days`. */
  suffix?: string;
  /** Rendered at the end of the label row, e.g. an "Edited · Reset" control. */
  labelRight?: ReactNode;
}

export function FormField({
  ref,
  label,
  required,
  error,
  hint,
  prefix,
  suffix,
  labelRight,
  multiline,
  style,
  ...inputProps
}: FormFieldProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
        {labelRight}
      </View>
      <View style={[styles.box, multiline && styles.multiline, !!error && styles.boxError]}>
        {!!prefix && <Text style={styles.affix}>{prefix}</Text>}
        <AppTextInput
          ref={ref}
          placeholderTextColor={Colors.tabInactive}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          accessibilityLabel={label}
          style={[styles.input, multiline && styles.inputMultiline, style]}
          {...inputProps}
        />
        {!!suffix && <Text style={styles.affix}>{suffix}</Text>}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!error && !!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text, flexShrink: 1 },
  required: { color: Colors.danger },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
  },
  multiline: { alignItems: 'flex-start', minHeight: 88 },
  boxError: { borderColor: Colors.danger, backgroundColor: Colors.dangerSoft },
  affix: { fontSize: 16, color: Colors.textMuted, fontWeight: '600' },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: Colors.text, paddingVertical: Spacing.md },
  inputMultiline: { minHeight: 86 },
  error: { fontSize: 13, color: Colors.danger, fontWeight: '500' },
  hint: { fontSize: 12, color: Colors.textMuted },
});
