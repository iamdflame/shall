export function run({ text }) {
  const tokens = text.split(/\s+/).filter(t => t.length > 0);
  let count = 0;
  for (const token of tokens) {
    if (token.length >= 3) count++;
  }
  return count;
}