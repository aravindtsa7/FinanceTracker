export const KYC_ID_TYPES = ['Aadhar', 'License', 'Others'] as const;
type KycIdType = (typeof KYC_ID_TYPES)[number];

/** Keep legacy IDs/numbers/photos; map unsupported labels into the current selector. */
export function normalizeKycType(raw: string | null | undefined): KycIdType | '' {
  const value = raw?.trim().toLowerCase().replace(/[\s_-]+/g, '') ?? '';
  if (!value) return '';
  if (['aadhar', 'aadhaar', 'aadharcard', 'aadhaarcard'].includes(value)) return 'Aadhar';
  if (['license', 'licence', 'drivinglicense', 'drivinglicence', 'dl'].includes(value)) return 'License';
  return 'Others';
}
