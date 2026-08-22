export function run({ subtotal, couponPercent }) {
  const clampCoupon = (p) => {
    if (p > 100) return 100;
    if (p < 0) return 0;
    return p;
  };

  const roundHalfAwayFromZero = (value, decimals) => {
    const factor = Math.pow(10, decimals);
    const scaled = value * factor;
    const rounded =
      scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
    return rounded / factor;
  };

  const cp = clampCoupon(couponPercent);
  const discountedSubtotal = subtotal * (1 - cp / 100);

  const shippingFee = discountedSubtotal < 50 ? 6 : 0;
  const taxableAmount = discountedSubtotal + shippingFee;

  const total = taxableAmount * 1.08;

  return roundHalfAwayFromZero(total, 2);
}