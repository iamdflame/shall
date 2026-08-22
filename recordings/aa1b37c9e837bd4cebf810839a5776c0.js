export function run({ scores, playerScore }) {
  const higherScores = new Set();

  for (const score of scores) {
    if (score > playerScore) {
      higherScores.add(score);
    }
  }

  return higherScores.size + 1;
}