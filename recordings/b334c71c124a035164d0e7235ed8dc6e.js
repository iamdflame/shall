export function run({ scores, playerScore }) {
  if (scores.length === 0) {
    return 1;
  }

  const uniqueScores = Array.from(new Set(scores));
  uniqueScores.sort((a, b) => b - a);

  for (let i = 0; i < uniqueScores.length; i++) {
    if (playerScore >= uniqueScores[i]) {
      return i + 1;
    }
  }

  return uniqueScores.length + 1;
}