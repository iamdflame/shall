export function run({ subtotal, couponPercent }) {
  const coupon = couponPercent > 100 ? 100 : couponPercent < 0 ? 0 : couponPercent;
  const discountedSubtotal = subtotal * (1 - coupon / 100);
  const shipping = discountedSubtotal < 50 ? 6 : 0;
  const total = (discountedSubtotal + shipping) * 1.08;
  const scaled = Math.abs(total) * 100;
  const rounded = Math.floor(scaled + 0.5 + Number.EPSILON * scaled);
  return (total < 0 ? -rounded : rounded) / 100;
}