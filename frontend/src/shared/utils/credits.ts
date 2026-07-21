export function formatCreditAmount(value: number, maximumFractionDigits = 6) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }
  if (Number.isInteger(numericValue)) {
    return String(numericValue);
  }
  return numericValue.toFixed(maximumFractionDigits).replace(/\.?0+$/, '');
}

export function formatIntegerCreditAmount(value: number) {
  const numericValue = Number(value);
  return String(Math.floor(Number.isFinite(numericValue) ? numericValue : 0));
}
