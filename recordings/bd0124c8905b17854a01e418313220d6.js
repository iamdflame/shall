export function run(inputs) {
  const text = inputs.text;
  const tokens = text.split(/\s+/).filter(t => t.length > 0);
  let count = 0;
  for (const tok of tokens) {
    if (tok.length >= 3) count++;
  }
  return count;
}