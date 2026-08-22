export function run({ text }) {
  if (typeof text !== 'string') return 0;
  const words = text.match(/\b[a-zA-Z]+\b/g);
  if (!words) return 0;
  let count = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i].length >= 3) count++;
  }
  return count;
}