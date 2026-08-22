export function run({ scores, playerScore }) {
  if (!Array.isArray(scores) || scores.length === 0) {
    return 1;
  }
  const uniqueScores = Array.from(new Set(scores));
  uniqueScores.sort((a, b) => b - a);
  let rank = 1;
  for (const score of uniqueScores) {
    if (score > playerScore) {
      rank++;
    } else {
      break;
    }
  }
  return rank;
}