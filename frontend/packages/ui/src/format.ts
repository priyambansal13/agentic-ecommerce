/** Display formatting (money arrives as integer minor units + ISO currency from @ac/contracts DTOs). */
const digits = (c: string) => (c === 'JPY' ? 0 : 2);
export const fmtMoney = (minor: number, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 10 ** digits(currency));
export const fmtMoneyCompact = (minor: number, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(minor / 10 ** digits(currency));
export const fmtInt = (n: number) => new Intl.NumberFormat('en-IN').format(n);
export const fmtPct = (r: number) => `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;
export const fmtAge = (hours: number) => (hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`);
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const fmtDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
