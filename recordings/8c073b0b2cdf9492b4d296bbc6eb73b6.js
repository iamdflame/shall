export function run({ password }) {
  if (typeof password !== 'string' || password.length < 8) {
    return 0;
  }
  let strength = 0;
  if (/[a-z]/.test(password)) strength += 1;
  if (/[A-Z]/.test(password)) strength += 1;
  if (/[0-9]/.test(password)) strength += 1;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 1;
  if (strength > 4) strength = 4;
  return strength;
}