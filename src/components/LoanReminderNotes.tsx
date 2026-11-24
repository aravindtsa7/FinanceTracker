import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { FormField } from '@/components/FormField';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { addLoanReminder, deleteLoanReminder } from '@/db/database';
import { scheduleAutoSync } from '@/services/googleDriveBackup';
import type { LoanReminderNote } from '@/types/finance';
import { formatDateTime } from '@/utils/format';

export function LoanReminderNotes({ loanId, notes, onChanged }: {
  loanId: number;
  notes: readonly LoanReminderNote[];
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const locked = useRef(false);

  const save = async () => {
    const note = draft.trim();
    if (!note || locked.current) return;
    locked.current = true;
    setBusy('add');
    try {
      await addLoanReminder(loanId, note);
      setDraft('');
      scheduleAutoSync();
      await onChanged();
    } catch (error) {
      Alert.alert('Could not save note', error instanceof Error ? error.message : String(error));
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(id);
    try {
      await deleteLoanReminder(id);
      scheduleAutoSync();
      await onChanged();
    } catch (error) {
      Alert.alert('Could not delete note', error instanceof Error ? error.message : String(error));
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Reminder Notes</Text>
      <View style={styles.addRow}>
        <View style={styles.flex1}>
          <FormField label="New reminder" value={draft} onChangeText={setDraft}
            placeholder="Add a note…" editable={busy === null} returnKeyType="done"
            onSubmitEditing={() => void save()} />
        </View>
        <AppButton label="Save Note" icon="add" compact loading={busy === 'add'}
          style={styles.saveButton} disabled={!draft.trim() || busy !== null} onPress={() => void save()} />
      </View>
      {notes.length === 0 && <Text style={styles.muted}>No reminder notes yet.</Text>}
      {notes.map((reminder) => (
        <View key={reminder.id} style={styles.note}>
          <View style={styles.flex1}>
            <Text style={styles.noteText}>{reminder.note}</Text>
            <Text style={styles.muted}>{formatDateTime(reminder.created_at.replace(' ', 'T'))}</Text>
          </View>
          <Pressable disabled={busy !== null} onPress={() => void remove(reminder.id)}
            accessibilityRole="button" accessibilityLabel={`Delete reminder: ${reminder.note}`}
            style={({ pressed }) => [styles.delete, pressed && styles.pressed]}>
            <Ionicons name="trash-outline" size={18} color={Colors.danger} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm },
  title: { fontSize: 16, fontWeight: '700', color: Colors.text },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  saveButton: { minHeight: 48 },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderColor: Colors.border },
  flex1: { flex: 1, minWidth: 0, gap: 4 },
  noteText: { fontSize: 14, color: Colors.text },
  muted: { fontSize: 12, color: Colors.textMuted },
  delete: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
