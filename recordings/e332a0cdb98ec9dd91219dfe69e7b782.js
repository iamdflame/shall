export function run({ scores, playerScore }) {
  let rank = 1;
  const higherScores = new Set();

  for (const score of scores) {
    if (score > playerScore) higherScores.add(score);
  }

  rank += higherScores.size;
  return rank;
}