export function run({ text }) {
  return text
    .split(/\s+/)
    .filter(token => token !== "" && Array.from(token).length >= 3)
    .length;
}