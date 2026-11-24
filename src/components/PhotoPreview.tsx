import { Image, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { Spacing } from '@/constants/theme';

export function PhotoPreview({ uri, title, onClose }: { uri: string | null; title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.content, { paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + Spacing.md }]}>
        <AppButton label={`Close ${title}`} icon="close" variant="secondary" onPress={onClose} />
        {uri && <Image source={{ uri }} accessibilityLabel={title} resizeMode="contain" style={styles.image} />}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)', paddingHorizontal: Spacing.md, gap: Spacing.md },
  image: { flex: 1, width: '100%' },
});
