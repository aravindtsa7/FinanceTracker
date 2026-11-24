import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { Colors } from '@/constants/theme';

export function CustomerAvatar({ name, uri, size = 44 }: { name: string; uri: string; size?: number }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.avatar, dimensions]}>
      {uri && uri !== failedUri ? (
        <Image source={{ uri }} style={dimensions} accessibilityLabel={`${name}'s photo`} onError={() => setFailedUri(uri)} />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: Colors.navy, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { color: Colors.textOnDark, fontWeight: '800' },
});
