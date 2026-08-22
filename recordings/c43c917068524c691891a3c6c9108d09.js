export function run({ dice }) {
  const counts = new Map();

  for (const die of dice) {
    counts.set(die, (counts.get(die) || 0) + 1);
  }

  for (const [face, count] of counts) {
    if (count === 5) {
      return 2000;
    }
  }

  let score = 0;
  let setFace = null;

  for (const [face, count] of counts) {
    if (count >= 3) {
      setFace = face;
      score += face * 100;
      break;
    }
  }

  for (const die of dice) {
    if (setFace !== null && die === setFace) {
      const setCount = counts.get(setFace);
      if (counts.get(`__used_${setFace}`) < 3) {
        counts.set(`__used_${setFace}`, (counts.get(`__used_${setFace}`) || 0) + 1);
        continue;
      }
    }

    if (die === 1) {
      score += 50;
    } else if (die === 5) {
      score += 10;
    }
  }

  return score;
}