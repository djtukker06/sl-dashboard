// Wie mag de standaard-mailbox uit de env (MAIL_USER, van Daniel) gebruiken? Altijd hooguit
// één account. Een gewoon teamlid (rol 'lid', bv. Bram) NOOIT, tenzij zijn eigen adres
// toevallig MAIL_USER is of MAIL_ENV_USER_ID expliciet naar hem wijst.
// Zonder imports, zodat scripts/test-account.mjs dit los kan testen.
//   'ja'                hetzelfde adres als MAIL_USER, of het user-id uit MAIL_ENV_USER_ID,
//                       of de overgangsmodus (vóór 0021: één gebruiker);
//   'oudste_eigenaar'   alleen als dit de oudste actieve eigenaar is (de aanroeper controleert);
//   'nee'               alle andere gevallen.
export type EnvKeuze = 'ja' | 'nee' | 'oudste_eigenaar';

export function envMailboxKeuze(
  env: { mailUser?: string | null; vastId?: string | null },
  lid: { userId: string; email: string; rol: 'eigenaar' | 'lid'; overgang: boolean }
): EnvKeuze {
  const envUser = env.mailUser?.trim().toLowerCase();
  if (!envUser) return 'nee';
  if (lid.overgang) return 'ja';
  if (lid.email.trim().toLowerCase() === envUser) return 'ja';
  const vast = env.vastId?.trim().toLowerCase();
  if (vast) return lid.userId.toLowerCase() === vast ? 'ja' : 'nee';
  if (lid.rol !== 'eigenaar') return 'nee';
  return 'oudste_eigenaar';
}
