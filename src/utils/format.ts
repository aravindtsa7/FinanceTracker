import type { TenureType } from '@/types/finance';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  return inr.format(value);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-05` → `5 Oct 2026`. Also accepts `YYYY-MM-DD HH:MM:SS` timestamps (time is dropped). */
export function formatDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `2026-10-15` → `Thursday, 15 Oct 2026`. */
export function formatLongDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${formatDate(value)}`;
}

/** ISO timestamp → `15 Oct 2026, 2:05 pm` in the device's timezone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${formatDate(local)}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
}

const TENURE_UNITS: Record<TenureType, [string, string]> = {
  Daily: ['day', 'days'],
  Weekly: ['week', 'weeks'],
  Monthly: ['month', 'months'],
};

/** `('Weekly', 12)` → `12 weeks`. */
export function formatTenure(tenure: TenureType, period: number): string {
  const [one, many] = TENURE_UNITS[tenure];
  return `${period} ${period === 1 ? one : many}`;
}
