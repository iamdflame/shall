export function run({subtotal, couponPercent}) {
  // Clamp coupon percent between 0 and 100
  let cp = couponPercent;
  if (cp > 100) cp = 100;
  if (cp < 0) cp = 0;
  // Apply coupon
  const discounted = subtotal * (1 - cp / 100);
  // Determine shipping
  const shipping = discounted < 50 ? 6 : 0;
  // Calculate taxable amount
  const taxable = discounted + shipping;
  // Apply tax
  const totalBeforeRounding = taxable * 1.08;
  // Round to two decimals, half cent away from zero
  const sign = totalBeforeRounding < 0 ? -1 : 1;
  const absScaled = Math.abs(totalBeforeRounding * 100);
  const rounded = sign * (Math.floor(absScaled + 0.5) / 100);
  return rounded;
}