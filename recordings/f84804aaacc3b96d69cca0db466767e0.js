export function run({ text }) {
  if (text.length === 0) return 0;

  return text
    .trim()
    .split(/\s+/)
    .reduce((count, word) => {
      const letters = word.match(/\p{L}/gu);
      return count + (letters && letters.length >= 3 ? 1 : 0);
    }, 0);
}