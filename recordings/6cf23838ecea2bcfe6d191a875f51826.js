export function run({ subtotal, couponPercent }) {
  // Apply coupon
  if (couponPercent > 100) {
    couponPercent = 100;
  } else if (couponPercent < 0) {
    couponPercent = 0;
  }
  const discount = (subtotal * couponPercent) / 100;
  let total = subtotal - discount;

  // Add shipping if necessary
  if (total < 50) {
    total += 6;
  }

  // Add tax
  total += total * 0.08;

  // Round to two decimal places
  total = Math.round(total * 100) / 100;

  return total;
}