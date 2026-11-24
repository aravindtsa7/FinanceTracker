/** Reads both current JSON photo lists and single-photo URIs from older records/backups. */
export function parseUriList(raw: string | null | undefined): string[] {
  const text = raw?.trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter((uri): uri is string => typeof uri === 'string' && !!uri.trim()).map((uri) => uri.trim());
    }
    return typeof parsed === 'string' && parsed.trim() ? [parsed.trim()] : [];
  } catch {
    // Broken JSON must not be treated as an image URI.
    return /^[\[{\"]/.test(text) ? [] : [text];
  }
}
