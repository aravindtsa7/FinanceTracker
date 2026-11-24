import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { PhotoPreview } from '@/components/PhotoPreview';
import { Colors, Radius, Spacing } from '@/constants/theme';

interface PhotoGalleryProps {
  label: string;
  uris: readonly string[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
}

/** Shared thumbnail grid and full-screen viewer for forms and read-only detail screens. */
export function PhotoGallery({ label, uris, onRemove, disabled }: PhotoGalleryProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  return (
    <View style={styles.gallery}>
      {uris.map((uri, index) => (
        <View key={`${index}:${uri}`} style={styles.item}>
          <Pressable onPress={() => setPreviewIndex(index)} accessibilityRole="button"
            accessibilityLabel={`View ${label}, photo ${index + 1} of ${uris.length}`}>
            <Image source={{ uri }} style={styles.thumbnail} resizeMode="cover" />
          </Pressable>
          {onRemove && (
            <Pressable onPress={() => onRemove(index)} disabled={disabled} style={styles.remove}
              accessibilityRole="button" accessibilityLabel={`Remove ${label}, photo ${index + 1}`}
              accessibilityState={{ disabled: !!disabled }}>
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          )}
        </View>
      ))}
      <PhotoPreview uri={previewIndex === null ? null : uris[previewIndex] ?? null}
        title={label} onClose={() => setPreviewIndex(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  item: { width: 104, height: 104 },
  thumbnail: { width: 104, height: 104, borderRadius: Radius.md, backgroundColor: Colors.navySoft },
  remove: {
    position: 'absolute', top: 0, right: 0, width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  removeText: {
    width: 28, height: 28, lineHeight: 26, textAlign: 'center', borderRadius: 14,
    backgroundColor: Colors.danger, color: Colors.textOnDark, fontSize: 24, fontWeight: '700',
  },
});
