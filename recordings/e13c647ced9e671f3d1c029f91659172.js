export function run({ subtotal, couponPercent }) {
  // Requirement 1.2 and 1.3: Clamp couponPercent between 0 and 100
  if (couponPercent > 100) couponPercent = 100;
  if (couponPercent < 0) couponPercent = 0;

  // Requirement 1.1: Apply coupon
  let discounted = subtotal * (1 - couponPercent / 100);

  // Requirement 2.1: Add shipping if needed
  if (discounted < 50) discounted += 6;

  // Requirement 3.1: Add 8% sales tax
  let total = discounted * 1.08;

  // Requirement 4.1: Round to two decimal places
  total = Math.round(total * 100) / 100;

  return total;
}