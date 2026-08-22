export function run(inputs) {
  const text = inputs && typeof inputs.text === "string" ? inputs.text : "";

  const matches = text.match(/[A-Za-z]+/g);
  if (!matches) return 0;

  let count = 0;
  for (const w of matches) {
    if (w.length >= 3) count++;
  }
  return count;
}