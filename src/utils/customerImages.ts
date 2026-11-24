import { Directory, File, Paths } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';

/** Picker results live in cache on native; retain an app-owned copy for future launches. */
export async function persistCustomerImage(asset: ImagePickerAsset): Promise<string> {
  if (Platform.OS === 'web') {
    return asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
  }
  const directory = new Directory(Paths.document, 'customer-images');
  directory.create({ idempotent: true, intermediates: true });
  const source = new File(asset.uri);
  const extension = source.extension || '.jpg';
  const destination = new File(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  await source.copy(destination);
  return destination.uri;
}
