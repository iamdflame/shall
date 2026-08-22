export function run(input) {
  const subtotal = input.subtotal;
  let couponPercent = input.couponPercent;

  let pct = Number.isFinite(couponPercent) ? Number(couponPercent) : 0;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  const discountedSubtotal = subtotal * (1 - pct / 100);

  const shipping = discountedSubtotal < 50 ? 6 : 0;

  const taxableBase = discountedSubtotal + shipping;
  const tax = taxableBase * 0.08;

  const total = taxableBase + tax;

  return Math.round(total * 100) / 100;
}