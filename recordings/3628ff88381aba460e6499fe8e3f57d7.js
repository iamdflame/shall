export function run(inputs) {
  const subtotal = inputs.subtotal;
  let couponPercent = inputs.couponPercent;

  // Requirement 1.2 and 1.3: clamp coupon to [0, 100]
  if (couponPercent > 100) couponPercent = 100;
  if (couponPercent < 0) couponPercent = 0;

  // Requirement 1.1: apply coupon
  const discounted = subtotal * (1 - (couponPercent / 100));

  // Requirement 2.1: shipping if order is below 50 (after discount)
  const shipping = discounted < 50 ? 6 : 0;

  // Requirement 3.1: add 8% sales tax (applied to discounted amount plus shipping)
  const preTaxTotal = discounted + shipping;
  const totalWithTax = preTaxTotal * 1.08;

  // Requirement 4.1: round to two decimal places
  const rounded = Math.round(totalWithTax * 100) / 100;

  // Normalize negative zero to positive zero
  return Object.is(rounded, -0) ? 0 : rounded;
}