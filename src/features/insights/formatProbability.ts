export function formatProbability(value: number, locale: string): string {
  if (value > 0 && value * 100 < 0.001) return `<${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(0.001)}%`;
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 3 }).format(value);
}
