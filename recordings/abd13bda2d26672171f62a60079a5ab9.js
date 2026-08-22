export function run({ subtotal, couponPercent }) {
  // Apply coupon percentage constraints
  if (couponPercent > 100) couponPercent = 100;
  if (couponPercent < 0) couponPercent = 0;

  // Calculate discounted subtotal
  const discount = (subtotal * couponPercent) / 100;
  let discountedSubtotal = subtotal - discount;

  // Apply shipping fee if necessary
  let shippingFee = 0;
  if (discountedSubtotal < 50) {
    shippingFee = 6;
  }

  // Calculate total with tax
  const taxableAmount = discountedSubtotal + shippingFee;
  const tax = taxableAmount * 0.08;
  const total = taxableAmount + tax;

  // Round to two decimal places
  return Math.round(total * 100) / 100;
}