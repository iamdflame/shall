export function run({ subtotal, couponPercent }) {
  let cp = couponPercent;
  if (cp > 100) {
    cp = 100;
  } else if (cp < 0) {
    cp = 0;
  }
  const discounted = subtotal * (1 - cp / 100);
  const shipping = discounted < 50 ? 6 : 0;
  const preTaxTotal = discounted + shipping;
  const totalWithTax = preTaxTotal * 1.08;
  const roundedTotal = Math.round(totalWithTax * 100) / 100;
  return roundedTotal;
}