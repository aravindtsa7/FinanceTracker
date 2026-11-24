import { Alert, Linking } from 'react-native';

/** Keeps only digits and a leading `+`, which is what dialers expect. */
export function dialableNumber(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/** Accepts 7–15 digits (local landlines up to full international numbers), ignoring spaces, dashes and brackets. */
export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

export function callNumber(phone: string): void {
  const number = dialableNumber(phone);
  if (!number) {
    Alert.alert('No phone number', 'There is no phone number saved for this contact.');
    return;
  }
  Linking.openURL(`tel:${number}`).catch(() => {
    Alert.alert('Cannot place call', `Unable to open the dialer for ${phone}.`);
  });
}
