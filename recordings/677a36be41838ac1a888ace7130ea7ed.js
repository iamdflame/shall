export function run({ dice }) {
  let score = 0;
  const freq = {};
  for (const d of dice) {
    freq[d] = (freq[d] || 0) + 1;
  }
  for (const face in freq) {
    if (freq[face] === 5) {
      return 2000;
    }
  }
  let setFace = null;
  for (const face of [1, 2, 3, 4, 5, 6]) {
    if ((freq[face] || 0) >= 3) {
      setFace = face;
      break;
    }
  }
  if (setFace !== null) {
    score += setFace * 100;
    freq[setFace] = 0;
  }
  score += (freq[1] || 0) * 50;
  score += (freq[5] || 0) * 10;
  return score;
}