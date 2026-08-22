export function run({ subtotal, couponPercent }) {
  let pct = couponPercent;
  if (pct > 100) pct = 100;
  if (pct < 0) pct = 0;

  let total = subtotal * (1 - pct / 100);

  if (total < 50) total += 6;

  total *= 1.08;

  return Number(total.toFixed(2));
}