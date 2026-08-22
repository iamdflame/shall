export function run({ dice }) {
  const counts = {};
  let score = 0;

  // Count occurrences of each face
  for (const die of dice) {
    counts[die] = (counts[die] || 0) + 1;
  }

  // Check for sets
  for (const face in counts) {
    const count = counts[face];
    const faceValue = parseInt(face, 10);

    if (count === 5) {
      return 2000;
    } else if (count >= 3) {
      score += faceValue * 100;
    }
  }

  // Score remaining singles
  for (const face in counts) {
    const count = counts[face];
    const faceValue = parseInt(face, 10);

    if (count < 3) {
      if (faceValue === 1) {
        score += count * 50;
      } else if (faceValue === 5) {
        score += count * 10;
      }
    }
  }

  return score;
}