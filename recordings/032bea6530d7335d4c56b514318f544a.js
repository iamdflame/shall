export function run(inputs) {
  const dice = Array.isArray(inputs?.dice) ? inputs.dice : [];

  const n = dice.length;

  // Requirement 1.2: exactly five dice all the same face
  if (n === 5) {
    let allSame = true;
    for (let i = 1; i < 5; i++) {
      if (dice[i] !== dice[0]) {
        allSame = false;
        break;
      }
    }
    if (allSame) return 2000;
  }

  const counts = new Map();
  for (const d of dice) counts.set(d, (counts.get(d) || 0) + 1);

  let score = 0;

  // Track which faces are consumed by the "three or more of a kind" rule.
  const consumedFaces = new Set();

  // Requirement 1.1: three or more dice show the same face
  for (const [face, count] of counts.entries()) {
    if (count >= 3) {
      score += face * 100;
      consumedFaces.add(face);
    }
  }

  // Requirement 2: Singles on remaining dice
  for (const d of dice) {
    if (consumedFaces.has(d)) continue;
    if (d === 1) score += 50;
    else if (d === 5) score += 10;
  }

  // Requirement 3.1: If no rule above applies then return 0
  return score === 0 ? 0 : score;
}