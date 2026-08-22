export function run({ text }) {
  if (!text || typeof text !== 'string') return 0;

  const words = text.split(/\s+/);
  const significantWords = words.filter(word => word.length >= 3);

  return significantWords.length;
}