export function run({ scores, playerScore }) {
  if (scores.length === 0) return 1;

  let higherCount = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > playerScore) higherCount++;
  }
  return higherCount + 1;
}