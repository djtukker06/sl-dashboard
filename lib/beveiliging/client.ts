// Fetch-hulpje voor de beveiligingsschermen (browser). Bij "niet ingelogd" naar /login, bij
// "eerst je 2FA-code" naar /login/2fa (met terugweg naar deze pagina).
export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin'
    });
  } catch {
    throw new Error('Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string; stap?: string }) | null;
  if (res.status === 401 && data?.code !== 'code_fout') {
    const hier = window.location.pathname + window.location.search;
    if (data?.code === 'wachtwoord_nodig') window.location.href = '/nieuw-wachtwoord';
    else if (data?.code === 'tfa_nodig' && data.stap === 'uitdaging') window.location.href = `/login/2fa?next=${encodeURIComponent(hier)}`;
    else if (data?.code !== 'tfa_nodig') window.location.href = `/login?next=${encodeURIComponent(hier)}`;
    throw new Error(data?.error || 'Je bent uitgelogd.');
  }
  if (!res.ok) throw new Error(data?.error || 'Er ging iets mis. Probeer het opnieuw.');
  return data as T;
}

export function datumTijd(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
