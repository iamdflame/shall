export function run({ password }) {
  if (typeof password !== "string") password = String(password);

  if (password.length < 8) return 0;

  let points = 0;

  if (/[a-z]/.test(password)) points += 1;
  if (/[A-Z]/.test(password)) points += 1;
  if (/[0-9]/.test(password)) points += 1;
  if (/[^a-zA-Z0-9]/.test(password)) points += 1;

  return Math.min(4, points);
}