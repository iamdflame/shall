export function run({ subtotal, couponPercent }) {
  let coupon = couponPercent;
  if (coupon > 100) coupon = 100;
  if (coupon < 0) coupon = 0;

  const discountedSubtotal = subtotal * (1 - coupon / 100);
  const shipping = discountedSubtotal < 50 ? 6 : 0;
  const totalBeforeRounding = (discountedSubtotal + shipping) * 1.08;

  const absoluteValue = Math.abs(totalBeforeRounding);
  const rounded = Math.floor(absoluteValue * 100 + 0.5) / 100;
  return totalBeforeRounding < 0 ? -rounded : rounded;
}