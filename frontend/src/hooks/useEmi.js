export function calculateEmi(principal, annualRate, months) {
  const monthlyRate = annualRate / 12 / 100;
  if (!principal || !months) return 0;
  if (!monthlyRate) return Math.round(principal / months);
  const emi = (principal * monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1);
  return Math.round(emi);
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}
