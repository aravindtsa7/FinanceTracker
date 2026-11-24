import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { FormField } from '@/components/FormField';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuthLicense } from '@/hooks/useAuthLicense';
import { loginUser, messageForError, registerUser, sendPasswordReset } from '@/services/authLicenseService';

export function AuthForm({ registration = false }: { registration?: boolean }) {
  const session = useAuthLicense();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailError = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Enter a valid email address';
  const passwordError = password.length >= (registration ? 6 : 1) ? undefined : registration ? 'Use at least 6 characters' : 'Enter your password';
  const nameError = !registration || (name.trim().length > 0 && name.trim().length <= 100) ? undefined : 'Enter your name (up to 100 characters)';
  const phoneError = !registration || /^\+?[\d ()-]{7,24}$/.test(phone.trim()) ? undefined : 'Enter a valid phone number';
  const submit = async () => {
    setSubmitted(true);
    if (emailError || passwordError || nameError || phoneError || busy) return;
    setBusy(true); setError(null);
    try {
      if (registration) {
        await registerUser(name, email, phone, password);
        Alert.alert('Account created', 'A verification email was sent. Please verify your registered email. Your trial status is shown in the app.');
      } else await loginUser(email, password);
    } catch (e) { setError(messageForError(e)); }
    finally { setBusy(false); }
  };
  const forgot = async () => {
    if (emailError) { setSubmitted(true); setError('Enter your registered email above to reset your password.'); return; }
    setBusy(true); setError(null);
    try {
      await sendPasswordReset(email);
      Alert.alert('Check your email', 'If an account exists for this email, a password reset link has been sent.');
    } catch (e) { setError(messageForError(e)); }
    finally { setBusy(false); }
  };
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Ionicons name="shield-checkmark" color={Colors.emerald} size={40} />
            <Text style={styles.brandTitle}>TSA Finance Tracker</Text>
            <Text style={styles.brandNote}>Your collections. Secure and ready offline.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>{registration ? 'Create your account' : 'Welcome back'}</Text>
            <Text style={styles.note}>{registration ? 'Start your 7-day trial on this phone.' : 'Sign in to your account on this phone.'}</Text>
            {registration && <>
              <FormField label="Full name" value={name} onChangeText={setName} autoComplete="name" maxLength={100} error={submitted ? nameError : undefined} editable={!busy} />
              <FormField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={24} error={submitted ? phoneError : undefined} editable={!busy} />
            </>}
            <FormField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" error={submitted ? emailError : undefined} editable={!busy} />
            <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete={registration ? 'new-password' : 'current-password'} error={submitted ? passwordError : undefined} editable={!busy}
              labelRight={<Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} hitSlop={12} onPress={() => setVisible(!visible)}><Text style={styles.link}>{visible ? 'Hide password' : 'Show password'}</Text></Pressable>} />
            {!!(error ?? session.error) && <Text accessibilityRole="alert" style={styles.error}>{error ?? session.error}</Text>}
            <AppButton label={registration ? 'Create Account & Start Trial' : 'Login'} loading={busy} onPress={() => void submit()} />
            {!registration && <AppButton label="Forgot Password?" variant="outline" disabled={busy} onPress={() => void forgot()} />}
            <Link href={registration ? '/auth/login' : '/auth/register'} asChild>
              <Pressable accessibilityRole="link" disabled={busy} style={styles.navigation}><Text style={styles.link}>{registration ? 'Already registered? Login' : 'New here? Create an account'}</Text></Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.navy }, flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.xl },
  brand: { alignItems: 'center', gap: Spacing.sm },
  brandTitle: { color: Colors.textOnDark, fontSize: 25, fontWeight: '800', textAlign: 'center' },
  brandNote: { color: '#CBD5E1', textAlign: 'center' },
  card: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: Spacing.xl, borderRadius: Radius.lg, backgroundColor: Colors.card, gap: Spacing.lg },
  title: { fontSize: 23, color: Colors.navy, fontWeight: '800' }, note: { fontSize: 14, color: Colors.textMuted },
  link: { color: Colors.emeraldDark, fontWeight: '700' }, error: { color: Colors.danger, lineHeight: 21 }, navigation: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
});
