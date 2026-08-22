export function run({ dice }) {
  // Count occurrences of each face (1-6)
  const counts = [0, 0, 0, 0, 0, 0, 0]; // index 0 unused
  for (let i = 0; i < dice.length; i++) {
    const d = dice[i];
    counts[d] = (counts[d] || 0) + 1;
  }

  let score = 0;
  let used = [false, false, false, false, false]; // which dice have been used in a set

  // Check for five of a kind first (Requirement 1.2)
  for (let face = 1; face <= 6; face++) {
    if (counts[face] === 5) {
      return 2000;
    }
  }

  // Check for three or more of a kind (Requirement 1.1)
  let setFound = false;
  for (let face = 1; face <= 6; face++) {
    if (counts[face] >= 3) {
      score += face * 100;
      // Mark the first three dice of this face as used
      let toMark = 3;
      for (let i = 0; i < dice.length && toMark > 0; i++) {
        if (dice[i] === face && !used[i]) {
          used[i] = true;
          toMark--;
        }
      }
      setFound = true;
      break; // Only one set can be scored
    }
  }

  // Score singles (Requirement 2)
  for (let i = 0; i < dice.length; i++) {
    if (used[i]) continue;
    if (dice[i] === 1) {
      score += 50;
    } else if (dice[i] === 5) {
      score += 10;
    }
  }

  // Requirement 3: If no rule above applies, return 0
  if (score === 0) {
    return 0;
  }
  return score;
}