import { createContext, useContext, type ComponentProps, type Ref } from 'react';
import { Platform, StyleSheet, Text as NativeText, TextInput as NativeTextInput, type TextStyle } from 'react-native';

const InsideText = createContext(false);
export const MAX_FONT_SIZE_MULTIPLIER = 1.15;

function androidTypography(style: TextStyle): TextStyle | undefined {
  if (Platform.OS !== 'android') return undefined;
  return {
    fontFamily: style.fontFamily ?? 'sans-serif',
    // Use Android's standard faces instead of synthesizing intermediate OEM weights.
    fontWeight: !style.fontFamily && Number(style.fontWeight) >= 600 ? 'bold' : style.fontWeight,
    includeFontPadding: false,
    letterSpacing: 0,
    // Removing font padding still requires room for ascenders, descenders and accents.
    lineHeight: style.lineHeight ?? (style.fontSize ? Math.ceil(style.fontSize * 1.35) : undefined),
  };
}

/** Shared app text; explicit defaults also work with React 19 function components. */
export function AppText({ style, maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER, children, ...props }: ComponentProps<typeof NativeText>) {
  const nested = useContext(InsideText);
  const text = (
    <NativeText
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[!nested && styles.glyphSpace, style, androidTypography(StyleSheet.flatten(style) ?? {})]}>
      {children}
    </NativeText>
  );
  // Inline spans inherit their parent's metrics without adding padding between words.
  return nested ? text : <InsideText.Provider value={true}>{text}</InsideText.Provider>;
}

/** Preserves native input refs, focus methods and platform keyboard behavior. */
export function AppTextInput({ style, maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER, ...props }: ComponentProps<typeof NativeTextInput> & { ref?: Ref<NativeTextInput> }) {
  return (
    <NativeTextInput
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[styles.input, style, androidTypography(StyleSheet.flatten(style) ?? {})]}
    />
  );
}

const styles = StyleSheet.create({
  // Keep a trailing glyph buffer inside the measured text box, including pills.
  glyphSpace: { flexShrink: 1, minWidth: 0, paddingEnd: 2, paddingVertical: 1 },
  input: { minWidth: 0, paddingEnd: 2 },
});
