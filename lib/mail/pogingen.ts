// Rate limit voor het koppelen van een mailbox (elke poging logt echt in bij een
// mailserver). Zonder imports, zodat scripts/test-account.mjs dit los kan testen.

/** Max. 5 pogingen per 10 minuten per gebruiker (in het geheugen van deze serverinstantie). */
const POGINGEN = new Map<string, number[]>();
const VENSTER_MS = 10 * 60 * 1000;
const MAX_POGINGEN = 5;

export function magProberen(userId: string): boolean {
  const nu = Date.now();
  const recent = (POGINGEN.get(userId) ?? []).filter((t) => nu - t < VENSTER_MS);
  if (recent.length >= MAX_POGINGEN) {
    POGINGEN.set(userId, recent);
    return false;
  }
  recent.push(nu);
  POGINGEN.set(userId, recent);
  // Opruimen zodat de map niet groeit.
  if (POGINGEN.size > 200) for (const [k, v] of POGINGEN) if (!v.some((t) => nu - t < VENSTER_MS)) POGINGEN.delete(k);
  return true;
}

