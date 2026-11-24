import { useWindowDimensions } from 'react-native';

/** Smoothly reclaim space between 320dp and 360dp, including split-screen changes. */
export function useResponsiveLayout() {
  const { width } = useWindowDimensions();
  const scale = Math.min(1, Math.max(0, (width - 320) / 40));
  return {
    compact: width < 360,
    pagePadding: 12 + 4 * scale,
    cardPadding: 12 + 4 * scale,
    metricFontSize: 17 + 3 * scale,
    heroFontSize: 26 + 6 * scale,
  };
}
