import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { FormField } from '@/components/FormField';
import { auth } from '@/config/firebase';
import { Colors, Spacing } from '@/constants/theme';
import { useAuthLicense } from '@/hooks/useAuthLicense';
import { completeRegistration, logoutUser, messageForError, refreshLicenseStatus } from '@/services/authLicenseService';
import { shareBackup } from '@/utils/backup';
import { contactAdmin } from '@/utils/contactAdmin';

export function LicenseLockScreen() {
  const { profile, deviceId, status, error: syncError } = useAuthLicense();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(auth.currentUser?.displayName ?? '');
  const [phone, setPhone] = useState('');
  const email = profile?.email ?? auth.currentUser?.email ?? '';
  async function run(task: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await task(); } catch (e) { setError(messageForError(e)); } finally { setBusy(false); }
  }
  const title = status === 'tampered' ? 'Device clock needs verification' : status === 'expired' ? 'Activate your license' : 'Internet check required';
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.note}>{status === 'tampered' ? 'A backwards clock change was detected. Connect to the internet and check your activation status to restore access.' : status === 'expired' ? 'Your trial or subscription has ended. Contact TSA Admin to activate this device.' : 'Connect to the internet to verify your account. Offline access lasts up to three days after a successful license check.'}</Text>
    <Text selectable style={styles.email}>{email}</Text>
    <Text selectable style={styles.device}>{deviceId}</Text>
    <AppButton label="Copy Device ID" variant="outline" disabled={busy} onPress={() => void run(async () => { await Clipboard.setStringAsync(deviceId); Alert.alert('Copied', 'Device ID copied.'); })} />
    <AppButton label="Contact TSA Admin on WhatsApp" disabled={busy} onPress={() => void run(() => contactAdmin(deviceId, email))} />
    <AppButton label="Check Activation Status" variant="secondary" loading={busy} onPress={() => void run(refreshLicenseStatus)} />
    {!profile && <>
      <Text style={styles.note}>If account creation was interrupted, finish setup here. Existing accounts keep their original license and binding.</Text>
      <FormField label="Full name" value={name} onChangeText={setName} editable={!busy} />
      <FormField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!busy} />
      <AppButton label="Finish Account Setup" variant="outline" disabled={busy} onPress={() => void run(() => completeRegistration({ name, phone }))} />
    </>}
    {!!(error ?? syncError) && <Text accessibilityRole="alert" style={styles.error}>{error ?? syncError}</Text>}
    <Text style={styles.note}>Your offline finance records are still on this phone. You can export a backup while access is locked.</Text>
    <AppButton label="Export & Share Backup" icon="share-social" variant="outline" disabled={busy} onPress={() => void run(shareBackup)} />
    <AppButton label="Logout" variant="danger" disabled={busy} onPress={() => Alert.alert('Back up before logging out', 'Export a backup first if needed. Logging out keeps the local database on this phone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Logout', style: 'destructive', onPress: () => void run(() => logoutUser()) }])} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { flexGrow: 1, justifyContent: 'center', gap: Spacing.lg, padding: Spacing.xl, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { color: Colors.navy, fontSize: 27, fontWeight: '800' }, note: { color: Colors.textMuted, lineHeight: 22 }, email: { color: Colors.text, fontWeight: '600' },
  device: { color: Colors.emeraldDark, fontSize: 25, fontWeight: '800' }, error: { color: Colors.danger },
});
