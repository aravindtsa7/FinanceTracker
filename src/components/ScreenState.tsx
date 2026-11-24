import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';

/** Small banner confirming the DB answered, or showing why it didn't. */
export function DbStatus({ error, loading }: { error: string | null; loading: boolean }) {
  if (loading) {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={Colors.emerald} />
        <Text style={styles.muted}>Loading from database…</Text>
      </View>
    );
  }
  if (error) return <ErrorBanner error={error} />;
  return (
    <View style={[styles.row, styles.ok]}>
      <Ionicons name="checkmark-circle" size={18} color={Colors.emeraldDark} />
      <Text style={[styles.text, { color: Colors.emeraldDark }]}>Database connected (offline)</Text>
    </View>
  );
}

/** Inline error for a failed DB read; renders nothing when there is no error. */
export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <View style={[styles.row, styles.error]}>
      <Ionicons name="alert-circle" size={18} color={Colors.danger} />
      <Text style={[styles.text, { color: Colors.danger }]}>{error}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.section}>{children}</Text>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  ok: { backgroundColor: Colors.emeraldSoft },
  error: { backgroundColor: Colors.dangerSoft },
  text: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  muted: { fontSize: 13, color: Colors.textMuted },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
});
