import { Linking } from 'react-native';
import { SUPPORT_WHATSAPP_NUMBER } from '@/constants/config';
export function contactAdmin(deviceId: string, email: string, request = 'Please activate my Finance Tracker license.') {
  const message = `${request}\nDevice ID: ${deviceId}\nEmail: ${email}`;
  return Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`);
}
