export function run({ dice }) {
  const counts = new Map();

  for (const die of dice) {
    counts.set(die, (counts.get(die) || 0) + 1);
  }

  let score = 0;

  for (const [face, count] of counts) {
    if (count === 5) {
      score += 2000;
    } else if (count >= 3) {
      score += face * 100;
    } else if (face === 1) {
      score += count * 50;
    } else if (face === 5) {
      score += count * 10;
    }
  }

  return score;
}