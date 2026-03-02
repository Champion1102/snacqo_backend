const IST = 'Asia/Kolkata';

/**
 * Format a Date (stored as UTC) as date + time in IST for display in messages.
 * Used for coupon validFrom/validTo so users see times in Indian Standard Time.
 */
export function formatDateTimeIST(date: Date): string {
  return date.toLocaleString('en-IN', {
    timeZone: IST,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  }) + ' IST';
}
