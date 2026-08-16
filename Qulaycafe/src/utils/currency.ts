// Uzbekistan doesn't use decimal subunits in everyday pricing (no tiyin in
// practice), so amounts are shown as whole numbers with thousands separators
// and a "so'm" suffix — e.g. 114 000 so'm, not 114,000.00 so'm.
export function formatSom(amount: number): string {
  const rounded = Math.round(amount);
  const withSeparators = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${withSeparators} so'm`;
}
