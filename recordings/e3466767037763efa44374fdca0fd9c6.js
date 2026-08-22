export function run({ text }) {
  if (typeof text !== "string") return 0;
  const matches = text.match(/[A-Za-z]{3,}/g);
  return matches ? matches.length : 0;
}