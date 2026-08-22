export function run({ subtotal, couponPercent }) {
  const percentage = Math.min(100, Math.max(0, couponPercent));
  const discountedSubtotal = subtotal * (1 - percentage / 100);
  const shipping = discountedSubtotal < 50 ? 6 : 0;
  const total = (discountedSubtotal + shipping) * 1.08;
  return Math.round(total * 100) / 100;
}