'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { api, datumTijd } from '@/lib/beveiliging/client';
import { Backups } from './Backups';

// Eigenaarspagina /beveiliging: team & 2FA, back-ups (en keep-alive) en de audit-log.

interface Lid {
  userId: string;
  naam: string;
  email: string;
  rol: 'eigenaar' | 'lid';
  actief: boolean;
  factoren: number;
  laatstIngelogd: string | null;
  zelf: boolean;
}

interface Regel {
  id: number;
  op: string;
  userId: string | null;
  naam: string | null;
  actie: string;
  doel: string | null;
  details: Record<string, unknown>;
  bron: string;
  ip: string | null;
}

const ACTIES: Record<string, string> = {
  inloggen: 'Ingelogd',
  inloggen_mislukt: 'Inloggen mislukt',
  inlog_geblokkeerd: 'Inloggen geblokkeerd (te veel pogingen)',
  uitloggen: 'Uitgelogd',
  '2fa_ingeschreven': '2FA-apparaat toegevoegd',
  '2fa_verwijderd': '2FA-apparaat verwijderd',
  '2fa_gelukt': '2FA-code goed',
  '2fa_mislukt': '2FA-code fout',
  '2fa_geblokkeerd': '2FA geblokkeerd (te veel foute codes)',
  '2fa_reset_door_eigenaar': '2FA gereset door eigenaar',
  wachtwoord_gewijzigd: 'Wachtwoord gewijzigd',
  wachtwoord_herstel_aangevraagd: 'Herstelmail aangevraagd',
  mailbox_gekoppeld: 'Inbox gekoppeld',
  mailbox_gewijzigd: 'Inbox gewijzigd',
  mailbox_zichtbaarheid: 'Inbox gedeeld/privé',
  mailbox_ontkoppeld: 'Inbox ontkoppeld',
  export_bonnetjes: 'Bonnetjes geëxporteerd',
  export_social: 'Social geëxporteerd',
  drive_gekoppeld: 'Google Drive gekoppeld',
  drive_ontkoppeld: 'Google Drive ontkoppeld',
  backup_gemaakt: 'Back-up gemaakt',
  backup_mislukt: 'Back-up mislukt',
  backup_gedownload: 'Back-up gedownload',
  backup_bestanden: 'Bestanden naar back-up gekopieerd',
  team_gebruiker_aangemaakt: 'Gebruiker aangemaakt',
  team_gebruiker_gewijzigd: 'Gebruiker gewijzigd',
  team_gebruiker_gedeactiveerd: 'Gebruiker gedeactiveerd',
  team_gebruiker_geactiveerd: 'Gebruiker weer actief',
  team_gebruiker_verwijderd: 'Gebruiker verwijderd',
  cron_dagelijks: 'Nachtelijke taak (keep-alive + back-up)',
  cron_bestanden: 'Nachtelijke taak (bestanden)'
};

const GEVAARLIJK = /mislukt|geblokkeerd|reset|verwijderd|ontkoppeld|noodstop/;

const FILTERS: { waarde: string; label: string }[] = [
  { waarde: '', label: 'Alles' },
  { waarde: 'inlog', label: 'Inloggen' },
  { waarde: '2fa', label: 'Tweestapsverificatie' },
  { waarde: 'wachtwoord', label: 'Wachtwoord' },
  { waarde: 'mailbox', label: 'Inboxen' },
  { waarde: 'export', label: 'Exports' },
  { waarde: 'verwijderd', label: 'Verwijderd' },
  { waarde: 'drive', label: 'Google Drive' },
  { waarde: 'team', label: 'Team' },
  { waarde: 'backup', label: 'Back-ups' },
  { waarde: 'cron', label: 'Nachtelijke taken' }
];

function actieLabel(a: string): string {
  if (ACTIES[a]) return ACTIES[a];
  if (a.startsWith('verwijderd_')) return `Verwijderd: ${a.slice(11).replace(/_/g, ' ')}`;
  return a.replace(/_/g, ' ');
}

function detailTekst(d: Record<string, unknown>): string {
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}

export function BeveiligingApp({
  aal2,
  migratie,
  afdwingen,
  rls,
  mijnId
}: {
  aal2: boolean;
  migratie: boolean;
  afdwingen: boolean;
  rls: boolean;
  mijnId: string;
}) {
  return (
    <div className="ac">
      <ModuleKop label="Account" titel="Beveiliging & audit" />
      <div className="ac-inhoud">
        {!migratie && (
          <p className="ac-waarschuwing" role="status">
            Voer in Supabase <code>supabase/UITVOEREN_0026.sql</code> uit: dan werken 2FA in de database, de audit-log, de
            pogingenlimiet en de back-ups volledig.
          </p>
        )}
        {migratie && !afdwingen && (
          <p className="ac-waarschuwing" role="status">
            Tweestapsverificatie is tijdelijk niet verplicht (MFA_AFDWINGEN=uit in Vercel). Zet het weer aan zodra het kan.
          </p>
        )}
        {migratie && !rls && (
          <p className="ac-waarschuwing" role="status">
            Noodstop actief: de database controleert 2FA even niet. Zet hem terug met{' '}
            <code>node scripts/2fa-herstel.mjs --rls aan</code>.
          </p>
        )}
        {!aal2 ? (
          <section className="ac-blok">
            <header className="ac-blok-kop">
              <h2 className="ac-blok-titel">Eerst tweestapsverificatie</h2>
              <p className="ac-blok-uitleg">
                Deze pagina en de audit-log zijn alleen te openen met een sessie mét 2FA-code. Stel tweestapsverificatie in
                via Account en log daarna opnieuw in.
              </p>
            </header>
            <div className="ac-acties">
              <a className="db-knop db-knop-primair" href="/account#beveiliging">
                Naar Account › Beveiliging
              </a>
            </div>
          </section>
        ) : (
          <>
            <TeamTfa />
            <Backups />
            <AuditLog mijnId={mijnId} />
          </>
        )}
      </div>
    </div>
  );
}

function TeamTfa() {
  const [leden, setLeden] = useState<Lid[] | null>(null);
  const [fout, setFout] = useState('');
  const [resetId, setResetId] = useState<string | null>(null);
  const [reden, setReden] = useState('');
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState('');

  const [versie, setVersie] = useState(0);
  const laad = useCallback(() => setVersie((v) => v + 1), []);

  useEffect(() => {
    let weg = false;
    api<{ leden: Lid[] }>('/api/beveiliging/team')
      .then((r) => {
        if (weg) return;
        setLeden(r.leden);
        setFout('');
      })
      .catch((e) => !weg && setFout(e instanceof Error ? e.message : 'Laden mislukt.'));
    return () => {
      weg = true;
    };
  }, [versie]);

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetId) return;
    setBezig(true);
    setMelding('');
    try {
      const r = await api<{ verwijderd: number }>(`/api/beveiliging/team/${resetId}/2fa`, 'POST', { reden });
      setMelding(`2FA gereset (${r.verwijderd} ${r.verwijderd === 1 ? 'apparaat' : 'apparaten'} verwijderd). Bij de volgende keer inloggen stelt dit teamlid 2FA opnieuw in.`);
      setResetId(null);
      setReden('');
      laad();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Resetten mislukt.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="ac-blok" aria-labelledby="bv-team">
      <header className="ac-blok-kop">
        <h2 id="bv-team" className="ac-blok-titel">Team &amp; 2FA</h2>
        <p className="ac-blok-uitleg">
          Wie heeft tweestapsverificatie, en wanneer voor het laatst ingelogd. Telefoon kwijt? Reset de 2FA van dat
          teamlid; bij de volgende keer inloggen stelt hij het opnieuw in.
        </p>
      </header>
      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
      {!leden && !fout && <p className="ag-uitleg">Laden…</p>}
      {leden && (
        <div className="bv-tabel-wrap">
          <table className="bv-tabel">
            <thead>
              <tr>
                <th>Teamlid</th>
                <th>Rol</th>
                <th>2FA</th>
                <th>Laatst ingelogd</th>
                <th aria-label="Acties" />
              </tr>
            </thead>
            <tbody>
              {leden.map((l) => (
                <tr key={l.userId}>
                  <td>
                    {l.naam}
                    <div className="bv-klein">{l.email}</div>
                  </td>
                  <td className="bv-nowrap">
                    {l.rol === 'eigenaar' ? 'Admin' : 'Gebruiker'}
                    {!l.actief && <div className="bv-klein">gedeactiveerd</div>}
                  </td>
                  <td className="bv-nowrap">
                    <span className="bv-status">
                      <span className={`bv-stip ${l.factoren ? 'is-aan' : 'is-uit'}`} aria-hidden="true" />
                      {l.factoren ? `${l.factoren} ${l.factoren === 1 ? 'apparaat' : 'apparaten'}` : 'Nog niet'}
                    </span>
                  </td>
                  <td className="bv-nowrap">{datumTijd(l.laatstIngelogd)}</td>
                  <td className="bv-nowrap">
                    {!l.zelf && l.factoren > 0 && (
                      <button type="button" className="bv-link" onClick={() => setResetId(l.userId)}>
                        Reset 2FA
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resetId && (
        <form className="bv-rij-form" onSubmit={reset}>
          <label className="ag-label">
            Reden (komt in de audit-log)
            <input className="ag-veld" value={reden} maxLength={200} onChange={(e) => setReden(e.target.value)} placeholder="bv. telefoon kwijt" required autoFocus />
          </label>
          <button type="submit" className="db-knop db-knop-primair" disabled={bezig || reden.trim().length < 3}>
            {bezig ? 'Bezig…' : `2FA resetten van ${leden?.find((l) => l.userId === resetId)?.naam ?? 'teamlid'}`}
          </button>
          <button type="button" className="db-knop" onClick={() => setResetId(null)} disabled={bezig}>
            Annuleren
          </button>
        </form>
      )}
      {melding && (
        <p className="ac-ok" role="status">
          {melding}
        </p>
      )}
    </section>
  );
}

function AuditLog({ mijnId }: { mijnId: string }) {
  const [actie, setActie] = useState('');
  const [gebruiker, setGebruiker] = useState('');
  const [pagina, setPagina] = useState(0);
  const [regels, setRegels] = useState<Regel[] | null>(null);
  const [meer, setMeer] = useState(false);
  const [ontbreekt, setOntbreekt] = useState(false);
  const [fout, setFout] = useState('');
  const [gebruikers, setGebruikers] = useState<{ id: string; naam: string }[]>([]);

  useEffect(() => {
    let weg = false;
    const q = new URLSearchParams();
    if (actie) q.set('actie', actie);
    if (gebruiker) q.set('gebruiker', gebruiker);
    if (pagina) q.set('pagina', String(pagina));
    api<{ ontbreekt: boolean; regels?: Regel[]; meer?: boolean }>(`/api/beveiliging/audit?${q}`)
      .then((r) => {
        if (weg) return;
        setOntbreekt(r.ontbreekt);
        setRegels(r.regels ?? []);
        setMeer(Boolean(r.meer));
        setFout('');
        setGebruikers((oud) => {
          const m = new Map(oud.map((g) => [g.id, g.naam]));
          for (const x of r.regels ?? []) if (x.userId && !m.has(x.userId)) m.set(x.userId, x.naam ?? (x.userId === mijnId ? 'Jij' : x.userId.slice(0, 8)));
          return [...m].map(([id, naam]) => ({ id, naam }));
        });
      })
      .catch((e) => !weg && setFout(e instanceof Error ? e.message : 'Laden mislukt.'));
    return () => {
      weg = true;
    };
  }, [actie, gebruiker, pagina, mijnId]);

  return (
    <section className="ac-blok" aria-labelledby="bv-audit">
      <header className="ac-blok-kop">
        <h2 id="bv-audit" className="ac-blok-titel">Audit-log</h2>
        <p className="ac-blok-uitleg">
          Gevoelige acties: inloggen, 2FA, wachtwoorden, inboxen, exports, verwijderen en back-ups. Alleen jij kunt dit
          lezen; niemand kan regels wijzigen of verwijderen. IP-adressen staan er alleen als code (zelfde code = zelfde
          netwerk). Regels ouder dan 400 dagen worden opgeruimd.
        </p>
      </header>
      {ontbreekt ? (
        <p className="ag-uitleg">De audit-log bestaat nog niet: voer supabase/UITVOEREN_0026.sql uit.</p>
      ) : (
        <>
          <div className="bv-filters">
            <label className="ag-label">
              Soort
              <select
                className="ag-veld"
                value={actie}
                onChange={(e) => {
                  setActie(e.target.value);
                  setPagina(0);
                }}
              >
                {FILTERS.map((f) => (
                  <option key={f.waarde} value={f.waarde}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ag-label">
              Wie
              <select
                className="ag-veld"
                value={gebruiker}
                onChange={(e) => {
                  setGebruiker(e.target.value);
                  setPagina(0);
                }}
              >
                <option value="">Iedereen</option>
                {gebruikers.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.naam}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {fout && (
            <p className="ag-fout" role="alert">
              {fout}
            </p>
          )}
          {!regels && !fout && <p className="ag-uitleg">Laden…</p>}
          {regels && regels.length === 0 && <p className="ag-uitleg">Nog niets vastgelegd.</p>}
          {regels && regels.length > 0 && (
            <div className="bv-tabel-wrap">
              <table className="bv-tabel">
                <thead>
                  <tr>
                    <th>Wanneer</th>
                    <th>Wie</th>
                    <th>Wat</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {regels.map((r) => (
                    <tr key={r.id}>
                      <td className="bv-nowrap">{datumTijd(r.op)}</td>
                      <td>
                        {r.naam ?? (r.userId ? r.userId.slice(0, 8) : r.bron === 'app' ? 'onbekend' : r.bron)}
                        {r.ip && <div className="bv-klein">netwerk {r.ip}</div>}
                      </td>
                      <td>
                        <span className={`bv-actie${GEVAARLIJK.test(r.actie) ? ' is-gevaar' : ''}`}>{actieLabel(r.actie)}</span>
                        {r.bron !== 'app' && <div className="bv-klein">via {r.bron}</div>}
                      </td>
                      <td className="bv-klein">
                        {r.doel && <div>{r.doel}</div>}
                        {detailTekst(r.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(pagina > 0 || meer) && (
            <div className="bv-paginering">
              <button type="button" className="db-knop" onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0}>
                Nieuwer
              </button>
              <span>Pagina {pagina + 1}</span>
              <button type="button" className="db-knop" onClick={() => setPagina((p) => p + 1)} disabled={!meer}>
                Ouder
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
