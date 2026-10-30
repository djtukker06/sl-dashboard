'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, datumTijd } from '@/lib/beveiliging/client';

// Blok "Back-ups" op /beveiliging (alleen eigenaar met 2FA-sessie): laatste database-back-up,
// laatste bestandensync, laatste heartbeat (keep-alive), de laatste 20 runs, "Nu back-up
// maken" en downloaden (versleuteld). Nooit sleutels; alleen het sleutel-id.

interface Run {
  id: string;
  soort: 'db' | 'bestanden';
  bron: string;
  gestart: string;
  klaar: string | null;
  status: 'bezig' | 'ok' | 'mislukt' | 'overgeslagen';
  bestand: string | null;
  grootte: number | null;
  sleutelId: string | null;
  tellingen: Record<string, unknown>;
  fout: string | null;
  downloadbaar: boolean;
}

interface Status {
  migratie: boolean;
  ontbreekt: string[];
  sleutelId: string | null;
  laatsteDb: Run | null;
  laatsteDbOk: Run | null;
  laatsteBestanden: Run | null;
  heartbeat: { op: string; bron: string } | null;
  runs: Run[];
}

const BRON: Record<string, string> = { cron: 'Vercel Cron', github: 'GitHub Actions', handmatig: 'handmatig', script: 'script' };
const STATUS: Record<Run['status'], string> = { bezig: 'Bezig', ok: 'Gelukt', mislukt: 'Mislukt', overgeslagen: 'Overgeslagen' };

function grootte(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function geleden(iso: string | null, nu: number): string {
  if (!iso) return '';
  const ms = nu - new Date(iso).getTime();
  if (ms < 0) return 'zojuist';
  const min = Math.round(ms / 60_000);
  if (min < 60) return min <= 1 ? 'zojuist' : `${min} minuten geleden`;
  const uur = Math.round(min / 60);
  if (uur < 48) return `${uur} uur geleden`;
  return `${Math.round(uur / 24)} dagen geleden`;
}

function rijenTotaal(t: Record<string, unknown>): number | null {
  const tab = t.tabellen as Record<string, number> | undefined;
  if (!tab || typeof tab !== 'object') return null;
  return Object.values(tab).reduce((a, n) => a + (Number(n) || 0), 0);
}

export function Backups() {
  const [status, setStatus] = useState<Status | null>(null);
  const [nu, setNu] = useState(0);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState<'' | 'db' | 'bestanden'>('');
  const [melding, setMelding] = useState('');
  const [versie, setVersie] = useState(0);
  const laad = useCallback(() => setVersie((v) => v + 1), []);

  useEffect(() => {
    let weg = false;
    api<Status>('/api/beveiliging/backup')
      .then((s) => {
        if (weg) return;
        setStatus(s);
        setNu(Date.now());
        setFout('');
      })
      .catch((e) => !weg && setFout(e instanceof Error ? e.message : 'Laden mislukt.'));
    return () => {
      weg = true;
    };
  }, [versie]);

  async function start(soort: 'db' | 'bestanden') {
    setBezig(soort);
    setMelding('');
    setFout('');
    try {
      const r = await api<{ uitkomst: { status: string; bestand?: string; grootte?: number; gesynchroniseerd?: number; resterend?: number } }>(
        '/api/beveiliging/backup',
        'POST',
        { soort }
      );
      const u = r.uitkomst;
      if (soort === 'db') setMelding(`Back-up gemaakt: ${u.bestand ?? ''} (${grootte(u.grootte ?? null)}), versleuteld in Google Drive.`);
      else if (u.status === 'bezig') setMelding(`${u.gesynchroniseerd ?? 0} bestanden gekopieerd; nog ${u.resterend ?? 0} te gaan (gaat vannacht vanzelf verder).`);
      else setMelding(`Bestanden bijgewerkt: ${u.gesynchroniseerd ?? 0} nieuw of gewijzigd.`);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Mislukt.');
    } finally {
      setBezig('');
      laad();
    }
  }

  const hbOud = status?.heartbeat ? nu - new Date(status.heartbeat.op).getTime() > 72 * 3_600_000 : true;
  // Handmatig kan zonder CRON_SECRET; wel nodig: de back-upsleutel en Drive.
  const kanMaken = Boolean(status?.migratie) && !status?.ontbreekt.some((n) => !n.startsWith('CRON_SECRET'));

  return (
    <section className="ac-blok" id="backups" aria-labelledby="bv-backups">
      <header className="ac-blok-kop">
        <h2 id="bv-backups" className="ac-blok-titel">Back-ups</h2>
        <p className="ac-blok-uitleg">
          Eens per 3 dagen een volledige, versleutelde kopie van de database in Google Drive (map Studio Levant › Back-ups),
          plus de nieuwe bestanden (facturen, bonnetjes, social). Alleen de nieuwste 3 back-ups blijven staan; komt er een
          nieuwe bij, dan gaat de oudste weg. Elke nacht houdt een kleine taak Supabase wakker. Terugzetten gaat met{' '}
          <code>scripts/backup-herstellen.mjs</code> en de sleutel uit je wachtwoordmanager.
        </p>
      </header>

      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
      {!status && !fout && <p className="ag-uitleg">Laden…</p>}

      {status && !status.migratie && (
        <p className="ac-waarschuwing" role="status">
          Voer in Supabase <code>supabase/UITVOEREN_0026.sql</code> uit: dan starten de back-ups en zie je hier de status. De
          keep-alive werkt al (zodra <code>CRON_SECRET</code> in Vercel staat).
        </p>
      )}
      {status && status.ontbreekt.length > 0 && (
        <p className="ac-waarschuwing" role="status">
          Nog in te stellen in Vercel (Environment Variables): {status.ontbreekt.join(', ')}. Zie README › Back-ups.
        </p>
      )}

      {status && status.migratie && (
        <>
          <dl className="bk-overzicht">
            <div className="bk-vak">
              <dt>Laatste database-back-up</dt>
              <dd>
                {status.laatsteDb ? (
                  <>
                    <span className="bv-status">
                      <span className={`bv-stip ${status.laatsteDb.status === 'ok' ? 'is-aan' : status.laatsteDb.status === 'mislukt' ? 'is-uit' : ''}`} aria-hidden="true" />
                      {STATUS[status.laatsteDb.status]} · {datumTijd(status.laatsteDb.gestart)}
                    </span>
                    <span className="bk-sub">
                      {grootte(status.laatsteDb.grootte)} · via {BRON[status.laatsteDb.bron] ?? status.laatsteDb.bron}
                      {status.laatsteDb.fout ? ` · ${status.laatsteDb.fout}` : ''}
                    </span>
                    {status.laatsteDb.status !== 'ok' && status.laatsteDbOk && (
                      <span className="bk-sub">Laatste geslaagde: {datumTijd(status.laatsteDbOk.gestart)}</span>
                    )}
                  </>
                ) : (
                  <span className="bk-sub">Nog geen back-up gemaakt.</span>
                )}
              </dd>
            </div>
            <div className="bk-vak">
              <dt>Bestanden (elke 3 dagen)</dt>
              <dd>
                {status.laatsteBestanden ? (
                  <>
                    <span className="bv-status">
                      <span className={`bv-stip ${status.laatsteBestanden.status === 'ok' ? 'is-aan' : status.laatsteBestanden.status === 'mislukt' ? 'is-uit' : ''}`} aria-hidden="true" />
                      {status.laatsteBestanden.status === 'bezig' ? 'Ronde loopt nog' : STATUS[status.laatsteBestanden.status]} · {datumTijd(status.laatsteBestanden.gestart)}
                    </span>
                    <span className="bk-sub">
                      {Number(status.laatsteBestanden.tellingen.gesynchroniseerd ?? 0)} gekopieerd
                      {Number(status.laatsteBestanden.tellingen.totaal ?? 0) ? ` van ${Number(status.laatsteBestanden.tellingen.totaal)}` : ''}
                      {status.laatsteBestanden.fout ? ` · ${status.laatsteBestanden.fout}` : ''}
                    </span>
                  </>
                ) : (
                  <span className="bk-sub">Nog niet gesynchroniseerd.</span>
                )}
              </dd>
            </div>
            <div className="bk-vak">
              <dt>Keep-alive (Supabase wakker houden)</dt>
              <dd>
                {status.heartbeat ? (
                  <>
                    <span className="bv-status">
                      <span className={`bv-stip ${hbOud ? 'is-uit' : 'is-aan'}`} aria-hidden="true" />
                      {geleden(status.heartbeat.op, nu)}
                    </span>
                    <span className="bk-sub">
                      via {BRON[status.heartbeat.bron] ?? status.heartbeat.bron}
                      {hbOud ? ' · ouder dan 3 dagen: controleer CRON_SECRET en de cron in Vercel' : ''}
                    </span>
                  </>
                ) : (
                  <span className="bk-sub">Nog geen heartbeat. Die komt na de eerste nachtelijke cron.</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="ac-acties">
            <button type="button" className="db-knop db-knop-primair" onClick={() => start('db')} disabled={!kanMaken || bezig !== ''}>
              {bezig === 'db' ? 'Back-up maken…' : 'Nu back-up maken'}
            </button>
            <button type="button" className="db-knop" onClick={() => start('bestanden')} disabled={!kanMaken || bezig !== ''}>
              {bezig === 'bestanden' ? 'Bestanden kopiëren…' : 'Bestanden nu bijwerken'}
            </button>
            {status.laatsteDbOk?.downloadbaar && (
              <a className="db-knop" href={`/api/beveiliging/backup/${status.laatsteDbOk.id}/download`}>
                Download laatste (versleuteld)
              </a>
            )}
            {status.sleutelId && <span className="bk-sub">Sleutel-id {status.sleutelId}</span>}
          </div>
          {melding && (
            <p className="ac-ok" role="status">
              {melding}
            </p>
          )}

          {status.runs.length > 0 && (
            <div className="bv-tabel-wrap">
              <table className="bv-tabel sl-stapeltabel">
                <thead>
                  <tr>
                    <th>Wanneer</th>
                    <th>Soort</th>
                    <th>Status</th>
                    <th>Inhoud</th>
                    <th aria-label="Download" />
                  </tr>
                </thead>
                <tbody>
                  {status.runs.map((r) => {
                    const rijen = rijenTotaal(r.tellingen);
                    return (
                      <tr key={r.id}>
                        <td className="bv-nowrap sl-stapel-kop">
                          {datumTijd(r.gestart)}
                          <div className="bv-klein">via {BRON[r.bron] ?? r.bron}</div>
                        </td>
                        <td className="bv-nowrap" data-label="Soort">{r.soort === 'db' ? 'Database' : 'Bestanden'}</td>
                        <td data-label="Status">
                          <span className={`bv-actie${r.status === 'mislukt' ? ' is-gevaar' : ''}`}>{STATUS[r.status]}</span>
                          {r.fout && <div className="bv-klein">{r.fout}</div>}
                        </td>
                        <td className="bv-klein" data-label="Inhoud">
                          {r.soort === 'db'
                            ? [r.bestand, grootte(r.grootte), rijen !== null ? `${rijen} rijen` : null].filter(Boolean).join(' · ')
                            : `${Number(r.tellingen.gesynchroniseerd ?? 0)} bestanden${Number(r.tellingen.resterend ?? 0) ? `, nog ${Number(r.tellingen.resterend)}` : ''}`}
                        </td>
                        <td className="bv-nowrap sl-stapel-acties">
                          {r.downloadbaar && (
                            <a className="bv-link" href={`/api/beveiliging/backup/${r.id}/download`}>
                              Download
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
