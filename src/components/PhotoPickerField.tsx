import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { PhotoPreview } from '@/components/PhotoPreview';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { persistCustomerImage } from '@/utils/customerImages';

interface PhotoPickerFieldProps {
  label: string;
  value: string;
  onChange: (uri: string) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}

export function PhotoPickerField({ label, value, onChange, onBusyChange, disabled }: PhotoPickerFieldProps) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const picking = useRef(false);

  const pick = async (camera: boolean) => {
    if (disabled || picking.current) return;
    picking.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      if (camera && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access in your device settings to take a photo. You can also choose one from the gallery.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'], quality: 0.8, base64: Platform.OS === 'web',
        allowsEditing: true, aspect: [1, 1], allowsMultipleSelection: false,
      };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) onChange(await persistCustomerImage(result.assets[0]));
    } catch (error) {
      Alert.alert('Could not select photo', error instanceof Error ? error.message : String(error));
    } finally {
      picking.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {!!value && (
        <View style={styles.previewRow}>
          <Pressable onPress={() => setPreview(true)} accessibilityRole="button" accessibilityLabel={`View ${label}`}>
            <Image source={{ uri: value }} style={styles.thumbnail} resizeMode="contain" />
          </Pressable>
          <AppButton label="Remove" icon="trash-outline" compact variant="danger" disabled={disabled || busy} onPress={() => onChange('')} />
        </View>
      )}
      <View style={styles.buttons}>
        <AppButton label="Take Photo" icon="camera-outline" compact variant="secondary" style={styles.button}
          disabled={disabled || busy} onPress={() => void pick(true)} />
        <AppButton label="Choose from Gallery" icon="images-outline" compact variant="secondary" style={styles.button}
          disabled={disabled || busy} onPress={() => void pick(false)} />
      </View>
      {busy && <Text style={styles.hint}>Preparing photo…</Text>}
      <PhotoPreview uri={preview ? value : null} title={label} onClose={() => setPreview(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.sm },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  button: { flexGrow: 1, flexBasis: '47%' },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.md },
  thumbnail: { width: 112, height: 112, borderRadius: Radius.md, backgroundColor: Colors.navySoft },
  hint: { fontSize: 12, color: Colors.textMuted },
});
