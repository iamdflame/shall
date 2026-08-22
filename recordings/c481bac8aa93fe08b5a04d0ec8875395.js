export function run({ text }) {
  const words = text.match(/[A-Za-z]+/g) || [];
  return words.filter(word => word.length >= 3).length;
}