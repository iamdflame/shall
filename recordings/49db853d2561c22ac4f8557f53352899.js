export function run({ text }) {
  const tokens = text.trim().split(/\s+/);
  let count = 0;
  for (const token of tokens) {
    if (token.length >= 3) count++;
  }
  return count;
}