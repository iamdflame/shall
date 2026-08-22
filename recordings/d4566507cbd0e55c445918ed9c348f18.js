export function run({ subtotal, couponPercent }) {
  // Requirement 1: Coupon
  let percent = couponPercent;
  if (percent > 100) percent = 100;
  if (percent < 0) percent = 0;
  let discounted = subtotal * (1 - percent / 100);

  // Requirement 2: Shipping
  let shipping = discounted < 50 ? 6 : 0;
  let taxable = discounted + shipping;

  // Requirement 3: Tax
  let tax = taxable * 0.08;
  let total = taxable + tax;

  // Requirement 4: Presentation (round half away from zero)
  total = Math.round(total * 100 + (total > 0 ? 0.0000001 : -0.0000001)) / 100;

  return total;
}