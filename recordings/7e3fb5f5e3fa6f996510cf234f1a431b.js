export function run({ subtotal, couponPercent }) {
  let cp = couponPercent;
  if (cp > 100) cp = 100;
  if (cp < 0) cp = 0;

  const discountedSubtotal = subtotal * (1 - cp / 100);
  const shipping = discountedSubtotal < 50 ? 6 : 0;

  const taxBase = discountedSubtotal + shipping;
  const tax = taxBase * 0.08;

  const totalBeforeRounding = taxBase + tax;
  const total = Math.round(totalBeforeRounding * 100) / 100;

  return total;
}