export function run({ text }) {
  const tokens = text.split(/\s+/).filter(token => token.length >= 3);
  return tokens.length;
}