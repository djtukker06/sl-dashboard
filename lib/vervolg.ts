// Waar je na het inloggen naartoe gaat (?next=). Alleen interne paden: moet met één "/"
// beginnen (niet "//" of "/\" — dat zijn protocol-relatieve URL's naar een ander domein)
// en mag geen API- of auth-route zijn. Anders: het dashboard.
export function veiligVervolg(next: unknown): string {
  if (typeof next !== 'string' || next.length > 2048) return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f]/.test(next)) return '/';
  if (next.startsWith('/api/') || next.startsWith('/auth/') || next.startsWith('/login')) return '/';
  return next;
}
