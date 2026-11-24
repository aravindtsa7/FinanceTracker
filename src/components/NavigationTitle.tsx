import { StyleSheet, type ColorValue } from 'react-native';

import { AppText } from '@/components/AppText';

/** Both native stack and JS tab headers get the same bounded, wrapping title. */
export function NavigationTitle({ children, tintColor }: { children: string; tintColor?: ColorValue }) {
  return <AppText style={[styles.title, { color: tintColor }]} maxFontSizeMultiplier={1.1}
    numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>{children}</AppText>;
}

const styles = StyleSheet.create({
  title: { fontSize: 18, lineHeight: 22, fontWeight: '700' },
});
