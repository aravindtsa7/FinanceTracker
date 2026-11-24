import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { useAuthLicense } from '@/hooks/useAuthLicense';
import { logoutUser, messageForError, refreshLicenseStatus, requestDeviceTransfer } from '@/services/authLicenseService';
import { contactAdmin } from '@/utils/contactAdmin';

export default function DeviceTransferScreen() {
  const { profile, deviceId } = useAuthLicense();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('Ask TSA Admin to approve this phone. Your account remains on the current phone until the transfer is approved.');
  async function run(task: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await task(); } catch (e) { setError(messageForError(e)); } finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Verify your new phone</Text>
    <Text style={styles.text}>{profile?.email}</Text>
    <Text style={styles.text}>Old device: {profile?.boundDeviceId}</Text>
    <Text selectable style={styles.device}>New device: {deviceId}</Text>
    <Text style={styles.text}>{instructions}</Text>
    <AppButton label="Save Transfer Request" disabled={busy} onPress={() => void run(async () => {
      await requestDeviceTransfer();
      setInstructions('Your request is saved. TSA Admin can approve it in Firebase Console. Tap Check Transfer Status after approval.');
    })} />
    <AppButton label="Request Transfer via WhatsApp" variant="outline" disabled={busy} onPress={() => void run(async () => {
      if (!profile?.approveTransfer) await requestDeviceTransfer();
      await contactAdmin(deviceId, profile?.email ?? '', `Please approve my device transfer.\nOld Device ID: ${profile?.boundDeviceId}\nNew Device ID: ${deviceId}`);
      setInstructions('Request saved. After TSA Admin approves the transfer, tap Check Transfer Status.');
    })} />
    <AppButton label="Check Transfer Status" variant="secondary" loading={busy} onPress={() => void run(async () => {
      await refreshLicenseStatus();
      setInstructions('If this screen remains open, approval is still pending. Ask TSA Admin to approve the saved target device.');
    })} />
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <AppButton label="Cancel & Logout" variant="danger" disabled={busy} onPress={() => void run(() => logoutUser())} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { flexGrow: 1, padding: Spacing.xl, gap: Spacing.lg, justifyContent: 'center', maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { color: Colors.navy, fontSize: 27, fontWeight: '800' }, text: { color: Colors.textMuted, lineHeight: 22 }, device: { color: Colors.emeraldDark, fontWeight: '800', fontSize: 22 }, error: { color: Colors.danger },
});
