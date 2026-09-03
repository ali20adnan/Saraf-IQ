/**
 * أرقام لاتينية (0–9) مع فواصل الآلاف — تتجنب أرقامًا شرقية (٠١٢) لا يدعمها الخط في WebView.
 */
const LATIN_INT = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});

export function formatLatinDigits(value: number): string {
  return LATIN_INT.format(value);
}
