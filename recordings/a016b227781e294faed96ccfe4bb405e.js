export function run({ subtotal, couponPercent }) {
  // Clamp coupon percentage between 0 and 100
  let pct = Number(couponPercent);
  if (!Number.isFinite(pct)) pct = 0;
  if (pct > 100) pct = 100;
  if (pct < 0) pct = 0;

  const discounted = Number(subtotal) * (1 - pct / 100);

  // Shipping: add 6 if order (after coupon) is below 50
  const shipping = discounted < 50 ? 6 : 0;

  // Tax: 8% on the amount after coupon and shipping
  const taxable = discounted + shipping;
  const tax = taxable * 0.08;

  let total = taxable + tax;

  // Round to two decimal places
  total = Math.round(total * 100) / 100;

  return total;
}