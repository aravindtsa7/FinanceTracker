/** Parses user-typed numbers ("12,500", " 7.5 "); returns NaN for empty or invalid input. */
export function parseNumber(text: string): number {
  const cleaned = text.replace(/[,\s₹]/g, '');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return NaN;
  return Number(cleaned);
}

/** Formats a number for an editable input: no grouping, at most `decimals` places, no trailing zeros. */
export function toInputString(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '';
  return String(Number(value.toFixed(decimals)));
}

/** Allows only digits and one decimal point while typing (decimal-pad can still paste odd text). */
export function sanitizeDecimalInput(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
}
