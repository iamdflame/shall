export function run(inputs) {
  const subtotal = Number(inputs.subtotal);
  let couponPercent = Number(inputs.couponPercent);

  if (!Number.isFinite(subtotal)) {
    throw new Error("subtotal must be a finite number");
  }
  if (!Number.isFinite(couponPercent)) {
    throw new Error("couponPercent must be a finite number");
  }

  // Requirement 1: clamp coupon between 0 and 100
  if (couponPercent > 100) couponPercent = 100;
  if (couponPercent < 0) couponPercent = 0;

  // Apply coupon
  const discounted = subtotal * (1 - couponPercent / 100);

  // Requirement 2: shipping
  let shipping = 0;
  if (discounted < 50) shipping = 6;

  // Requirement 3: tax (8%)
  const taxed = (discounted + shipping) * 1.08;

  // Requirement 4: round to two decimals
  const total = Math.round(taxed * 100) / 100;

  return total;
}