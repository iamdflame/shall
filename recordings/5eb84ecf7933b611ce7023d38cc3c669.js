export function run({ subtotal, couponPercent }) {
  const coupon = Math.min(100, Math.max(0, couponPercent));
  let total = subtotal * (1 - coupon / 100);
  if (total < 50) total += 6;
  total *= 1.08;
  return Math.round(total * 100) / 100;
}