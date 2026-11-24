import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { PhotoGallery } from '@/components/PhotoGallery';
import { Colors, Spacing } from '@/constants/theme';
import { persistCustomerImage } from '@/utils/customerImages';

interface MultiPhotoPickerProps {
  label: string;
  value: string[];
  onChange: (uris: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

export function MultiPhotoPicker({ label, value, onChange, onBusyChange, disabled }: MultiPhotoPickerProps) {
  const [busy, setBusy] = useState(false);
  const picking = useRef(false);

  const pick = async (camera: boolean) => {
    if (disabled || picking.current) return;
    picking.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      if (camera && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access in your device settings to take a photo. You can also choose one from the gallery.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        // Native cropping and multi-selection are mutually exclusive. Add each cropped photo separately.
        allowsMultipleSelection: false,
        quality: 0.8,
        base64: Platform.OS === 'web',
      };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) {
        const uri = await persistCustomerImage(result.assets[0]);
        onChange([...value, uri]);
      }
    } catch (error) {
      Alert.alert('Could not select photo', error instanceof Error ? error.message : String(error));
    } finally {
      picking.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {value.length > 0 && <PhotoGallery label={label} uris={value} disabled={disabled || busy}
        onRemove={(index) => onChange(value.filter((_, i) => i !== index))} />}
      <View style={styles.buttons}>
        <AppButton label="Take Photo" icon="camera-outline" compact variant="secondary" style={styles.button}
          disabled={disabled || busy} onPress={() => void pick(true)} />
        <AppButton label="Choose from Gallery" icon="images-outline" compact variant="secondary" style={styles.button}
          disabled={disabled || busy} onPress={() => void pick(false)} />
      </View>
      <Text style={styles.hint}>{busy ? 'Preparing photo…' : 'Add photos one at a time. Tap a thumbnail to preview.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.sm },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  button: { flexGrow: 1, flexBasis: '47%' },
  hint: { fontSize: 12, color: Colors.textMuted },
});
