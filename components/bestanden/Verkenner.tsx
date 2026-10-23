'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Persoon } from '@/components/team/Persoon';
import type { DriveItem, DriveStatus, MapInhoud } from '@/lib/drive/types';
import { gewijzigdTekst, grootteTekst, isVoorbeeldbaar, soortVan } from '@/lib/drive/weergave';
import { BevestigDialoog, NaamDialoog, Voorbeeld } from './Dialogen';
import { BsIcoon } from './Iconen';
import { DriveApiFout, driveApi, inhoudUrl, type UploadDoel } from './driveApi';
import { NietGekoppeld } from './NietGekoppeld';
import { useDriveUpload } from './useDriveUpload';

// De bestandsverkenner van Bestanden, en (compact) het blok "Bestanden" op de klant- en
// projectpagina. Bladeren (broodkruimel), lijst of raster, slepen-uploaden (rechtstreeks
// naar Google, zie driveApi.ts), nieuwe map, hernoemen, naar de prullenbak, zoeken en een
// voorbeeld via de eigen proxy-route. Alles gaat via /api/drive/** (centrale teamcheck).

export type VerkennerStart = { map: string | null } | { klant: string } | { project: string };

const sorteer = (a: DriveItem, b: DriveItem) => (a.map === b.map ? a.naam.localeCompare(b.naam, 'nl', { numeric: true, sensitivity: 'base' }) : a.map ? -1 : 1);

// Lijst of raster: per browser onthouden (localStorage; zonder opslag alleen deze sessie).
type Weergave = 'lijst' | 'raster';
const WEERGAVE_SLEUTEL = 'sl-bestanden-weergave';
let weergaveGeheugen: Weergave | null = null;
function leesWeergave(): Weergave {
  if (weergaveGeheugen) return weergaveGeheugen;
  try {
    return localStorage.getItem(WEERGAVE_SLEUTEL) === 'raster' ? 'raster' : 'lijst';
  } catch {
    return 'lijst';
  }
}
function luisterWeergave(cb: () => void) {
  window.addEventListener('sl-bestanden-weergave', cb);
  return () => window.removeEventListener('sl-bestanden-weergave', cb);
}
function zetWeergave(w: Weergave) {
  weergaveGeheugen = w;
  try {
    localStorage.setItem(WEERGAVE_SLEUTEL, w);
  } catch {
    /* geen opslag: alleen deze sessie */
  }
  window.dispatchEvent(new Event('sl-bestanden-weergave'));
}

export function Verkenner({ start, status, compact = false }: { start: VerkennerStart; status: DriveStatus; compact?: boolean }) {
  const [inhoud, setInhoud] = useState<MapInhoud | null>(null);
  const [geenMap, setGeenMap] = useState(false);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<{ tekst: string; code?: string } | null>(null);
  const opgeslagen = useSyncExternalStore(luisterWeergave, leesWeergave, () => 'lijst' as Weergave);
  const weergave: Weergave = compact ? 'lijst' : opgeslagen;
  const [zoekterm, setZoekterm] = useState('');
  const [resultaten, setResultaten] = useState<DriveItem[] | null>(null);
  const [zoeken, setZoeken] = useState(false);
  const [sleep, setSleep] = useState(false);
  const [voorbeeld, setVoorbeeld] = useState<DriveItem | null>(null);
  const [hernoem, setHernoem] = useState<DriveItem | null>(null);
  const [weg, setWeg] = useState<DriveItem | null>(null);
  const [nieuweMap, setNieuweMap] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const bestandKiezer = useRef<HTMLInputElement>(null);
  const sleepTeller = useRef(0);

  const doelVoorStart: UploadDoel | null = 'klant' in start ? { klant: start.klant } : 'project' in start ? { project: start.project } : null;
  const uploadDoel: UploadDoel | null = inhoud ? (compact && doelVoorStart ? doelVoorStart : { map: inhoud.map.id }) : doelVoorStart;

  const haal = useCallback(
    async (mapId?: string | null) => {
      try {
        const url =
          mapId !== undefined
            ? `/api/drive/map${mapId ? `?id=${encodeURIComponent(mapId)}` : ''}`
            : 'klant' in start
              ? `/api/drive/map?klant=${start.klant}`
              : 'project' in start
                ? `/api/drive/map?project=${start.project}`
                : `/api/drive/map${start.map ? `?id=${encodeURIComponent(start.map)}` : ''}`;
        const { inhoud: i } = await driveApi<{ inhoud: MapInhoud | null }>(url);
        setInhoud(i ? { ...i, items: [...i.items].sort(sorteer) } : null);
        setGeenMap(!i);
        if (i && !compact) {
          const u = new URL(window.location.href);
          if (i.map.id === i.kruimels[0]?.id) u.searchParams.delete('map');
          else u.searchParams.set('map', i.map.id);
          u.searchParams.delete('drive');
          window.history.replaceState(null, '', u.pathname + u.search);
        }
      } catch (e) {
        const f = e instanceof DriveApiFout ? e : null;
        setFout({ tekst: f?.message ?? 'Er ging iets mis.', code: f?.code });
      } finally {
        setLaden(false);
      }
    },
    [start, compact]
  );

  /** Een (andere) map laden; undefined = de startmap. */
  const laad = useCallback(
    async (mapId?: string | null) => {
      setLaden(true);
      setFout(null);
      await haal(mapId);
    },
    [haal]
  );

  useEffect(() => {
    // Alleen bij het openen (laden staat al aan); navigeren gaat via laad(id). De state
    // wordt pas na het ophalen gezet (asynchroon).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void haal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zoeken (alleen in de grote verkenner), met een korte vertraging.
  useEffect(() => {
    if (compact) return;
    const term = zoekterm.trim();
    if (term.length < 2) return;
    let weg = false;
    const t = setTimeout(async () => {
      setZoeken(true);
      try {
        const r = await driveApi<{ items: DriveItem[] }>(`/api/drive/zoeken?q=${encodeURIComponent(term)}`);
        if (!weg) setResultaten(r.items);
      } catch (e) {
        if (!weg) setFout({ tekst: e instanceof Error ? e.message : 'Zoeken mislukt.', code: e instanceof DriveApiFout ? e.code : undefined });
      } finally {
        if (!weg) setZoeken(false);
      }
    }, 350);
    return () => {
      weg = true;
      clearTimeout(t);
    };
  }, [zoekterm, compact]);

  const { rijen, upload } = useDriveUpload((item, doel) => {
    // Alleen tonen als de map waarin geüpload werd nog open staat.
    setInhoud((i) =>
      i && (!('map' in doel) || doel.map === i.map.id) && !i.items.some((x) => x.id === item.id) ? { ...i, items: [...i.items, item].sort(sorteer) } : i
    );
  });

  async function uploadNu(bestanden: FileList | File[]) {
    if (!uploadDoel || !Array.from(bestanden).length) return;
    const eersteKeer = compact && geenMap;
    await upload(bestanden, uploadDoel);
    // Eerste upload in een klant-/projectblok: de map bestaat nu, dus opnieuw ophalen.
    if (eersteKeer) await laad();
  }

  function open(item: DriveItem) {
    if (item.map) {
      if (compact) window.location.assign(`/bestanden?map=${encodeURIComponent(item.id)}`);
      else {
        setZoekterm('');
        void laad(item.id);
      }
      return;
    }
    if (isVoorbeeldbaar(item.mime, item.naam)) setVoorbeeld(item);
    else window.location.assign(inhoudUrl(item.id, true));
  }

  async function maakDoelMap() {
    setLaden(true);
    try {
      const { inhoud: i } = await driveApi<{ inhoud: MapInhoud }>('/api/drive/map', 'POST', doelVoorStart ?? {});
      setInhoud({ ...i, items: [...i.items].sort(sorteer) });
      setGeenMap(false);
    } catch (e) {
      setFout({ tekst: e instanceof Error ? e.message : 'Niet gelukt.', code: e instanceof DriveApiFout ? e.code : undefined });
    } finally {
      setLaden(false);
    }
  }

  // ---- Lege staten / fouten ----
  if (fout && (fout.code === 'niet_gekoppeld' || fout.code === 'opnieuw_koppelen' || fout.code === 'niet_ingericht' || fout.code === 'tabel_ontbreekt')) {
    const s: DriveStatus =
      fout.code === 'tabel_ontbreekt' ? { ...status, tabellen: false } : fout.code === 'niet_ingericht' ? { ...status, ingericht: false } : { ...status, gekoppeld: false };
    return <NietGekoppeld status={s} opnieuw={fout.code === 'opnieuw_koppelen'} compact={compact} />;
  }

  const beschermd = new Set(inhoud?.beschermd ?? []);
  const inZoek = !compact && zoekterm.trim().length >= 2 && resultaten !== null;
  const lijst = (inZoek ? resultaten : null) ?? inhoud?.items ?? [];

  const sleepProps = uploadDoel
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          sleepTeller.current++;
          setSleep(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        },
        onDragLeave: () => {
          sleepTeller.current = Math.max(0, sleepTeller.current - 1);
          if (!sleepTeller.current) setSleep(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          sleepTeller.current = 0;
          setSleep(false);
          void uploadNu(e.dataTransfer.files);
        }
      }
    : {};

  return (
    <div className={`bs-verkenner${compact ? ' is-compact' : ''}${sleep ? ' is-sleep' : ''}`} {...sleepProps}>
      {!compact && (
        <div className="bs-balk">
          <nav className="bs-kruimels" aria-label="Map">
            {(inhoud?.kruimels ?? []).map((k, i, alle) => (
              <span key={k.id} className="bs-kruimel">
                {i > 0 && <span className="bs-kruimel-scheiding">/</span>}
                {i === alle.length - 1 && !inZoek ? (
                  <span aria-current="page">{k.naam}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setZoekterm('');
                      void laad(i === 0 ? null : k.id);
                    }}
                  >
                    {k.naam}
                  </button>
                )}
              </span>
            ))}
            {inZoek && (
              <span className="bs-kruimel">
                <span className="bs-kruimel-scheiding">/</span>
                <span aria-current="page">Zoekresultaten</span>
              </span>
            )}
          </nav>
          <div className="bs-balk-acties">
            <label className="bs-zoek">
              <BsIcoon naam="zoek" grootte={16} />
              <input
                type="search"
                className="ag-veld"
                placeholder="Zoeken in Studio Levant"
                aria-label="Zoeken in bestanden"
                value={zoekterm}
                onChange={(e) => setZoekterm(e.target.value)}
              />
            </label>
            <div className="ag-segment bs-weergave" role="group" aria-label="Weergave">
              <button type="button" className={weergave === 'lijst' ? 'is-aan' : ''} aria-pressed={weergave === 'lijst'} onClick={() => zetWeergave('lijst')} title="Lijst">
                <BsIcoon naam="lijst" grootte={16} />
              </button>
              <button type="button" className={weergave === 'raster' ? 'is-aan' : ''} aria-pressed={weergave === 'raster'} onClick={() => zetWeergave('raster')} title="Raster">
                <BsIcoon naam="raster" grootte={16} />
              </button>
            </div>
            <button type="button" className="db-knop" disabled={!inhoud || inZoek} onClick={() => setNieuweMap(true)}>
              <BsIcoon naam="nieuwemap" grootte={16} /> Nieuwe map
            </button>
            <button type="button" className="db-knop db-knop-primair" disabled={!uploadDoel || inZoek} onClick={() => bestandKiezer.current?.click()}>
              <BsIcoon naam="upload" grootte={16} /> Uploaden
            </button>
          </div>
        </div>
      )}

      {compact && (
        <div className="bs-blok-acties">
          {inhoud && (
            <Link className="db-kaart-link" href={`/bestanden?map=${encodeURIComponent(inhoud.map.id)}`}>
              Map openen →
            </Link>
          )}
          <button type="button" className="db-knop" disabled={!uploadDoel || laden} onClick={() => bestandKiezer.current?.click()}>
            <BsIcoon naam="upload" grootte={16} /> Uploaden
          </button>
        </div>
      )}

      <input
        ref={bestandKiezer}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void uploadNu(e.target.files);
          e.target.value = '';
        }}
      />

      {rijen.length > 0 && (
        <ul className="bs-uploads" aria-label="Uploads">
          {rijen.map((r) => (
            <li key={r.sleutel} className={`bs-upload is-${r.fase}`}>
              <span className="bs-upload-naam">{r.naam}</span>
              <span className="bs-upload-stand">
                {r.fase === 'fout' ? r.fout : r.fase === 'klaar' ? 'Klaar' : r.fase === 'wacht' ? 'Wacht…' : `${Math.round(r.voortgang * 100)}%`}
              </span>
              <span className="bs-upload-balk" style={{ '--bs-voortgang': `${Math.round(r.voortgang * 100)}%` } as React.CSSProperties} />
            </li>
          ))}
        </ul>
      )}

      {fout && (
        <p className="bs-fouttekst" role="alert">
          {fout.tekst}{' '}
          <button type="button" className="kp-linkknop" onClick={() => void laad(inhoud?.map.id ?? undefined)}>
            Opnieuw
          </button>
        </p>
      )}
      {melding && (
        <p className="bs-uitleg" role="status">
          {melding}
        </p>
      )}

      {laden && !inhoud ? (
        <p className="kp-leeg">Bestanden ophalen…</p>
      ) : compact && geenMap ? (
        <div className="bs-leeg">
          <p className="kp-leeg">Nog geen map in Drive. Die wordt aangemaakt bij de eerste upload{sleep ? '' : ' (of sleep bestanden hierheen)'}.</p>
          <button type="button" className="kp-linkknop" onClick={() => void maakDoelMap()}>
            Map nu aanmaken
          </button>
        </div>
      ) : zoeken && !inZoek ? (
        <p className="kp-leeg">Zoeken…</p>
      ) : lijst.length === 0 ? (
        <div className="bs-leeg">
          <p className="kp-leeg">{inZoek ? 'Niets gevonden.' : 'Deze map is leeg. Sleep bestanden hierheen of klik op Uploaden.'}</p>
        </div>
      ) : weergave === 'raster' && !compact ? (
        <ul className="bs-raster">
          {lijst.map((it) => (
            <li key={it.id} className="bs-kaartje">
              <button type="button" className="bs-kaartje-open" onClick={() => open(it)} title={it.naam}>
                <span className={`bs-kaartje-beeld is-${soortVan(it.mime, it.naam)}`}>
                  {soortVan(it.mime, it.naam) === 'afbeelding' && isVoorbeeldbaar(it.mime) && (it.grootte ?? 0) < 4_000_000 ? (
                    // eslint-disable-next-line @next/next/no-img-element -- bestand uit Drive via de eigen proxy
                    <img src={inhoudUrl(it.id)} alt="" loading="lazy" />
                  ) : (
                    <BsIcoon naam={soortVan(it.mime, it.naam)} grootte={34} />
                  )}
                </span>
                <span className="bs-kaartje-naam">{it.naam}</span>
              </button>
              <Acties item={it} beschermd={beschermd.has(it.id)} onHernoem={setHernoem} onWeg={setWeg} />
            </li>
          ))}
        </ul>
      ) : (
        <table className="bs-tabel">
          {!compact && (
            <thead>
              <tr>
                <th scope="col">Naam</th>
                <th scope="col" className="bs-kol-grootte">
                  Grootte
                </th>
                <th scope="col" className="bs-kol-datum">
                  Gewijzigd
                </th>
                <th scope="col">
                  <span className="sr-only">Acties</span>
                </th>
              </tr>
            </thead>
          )}
          <tbody>
            {lijst.map((it) => (
              <tr key={it.id}>
                <td className="bs-kol-naam">
                  <button type="button" className="bs-naam" onClick={() => open(it)} title={it.naam}>
                    <BsIcoon naam={soortVan(it.mime, it.naam)} className={`bs-type is-${soortVan(it.mime, it.naam)}`} />
                    <span className="bs-naam-tekst">{it.naam}</span>
                  </button>
                  {it.door && (
                    <span className="bs-door">
                      <Persoon id={it.door} voorvoegsel="door" />
                    </span>
                  )}
                </td>
                {!compact && <td className="bs-kol-grootte">{it.map ? '—' : grootteTekst(it.grootte)}</td>}
                <td className="bs-kol-datum">{gewijzigdTekst(it.gewijzigd)}</td>
                <td className="bs-kol-acties">
                  <Acties item={it} beschermd={beschermd.has(it.id)} onHernoem={setHernoem} onWeg={setWeg} compact={compact} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sleep && (
        <div className="bs-sleepvlak" aria-hidden="true">
          <BsIcoon naam="upload" grootte={28} />
          <span>Loslaten om te uploaden{inhoud ? ` naar ${inhoud.map.naam}` : ''}</span>
        </div>
      )}

      {voorbeeld && <Voorbeeld item={voorbeeld} onSluit={() => setVoorbeeld(null)} />}
      {nieuweMap && inhoud && (
        <NaamDialoog
          titel="Nieuwe map"
          label={`Naam (in ${inhoud.map.naam})`}
          knop="Aanmaken"
          onAnnuleer={() => setNieuweMap(false)}
          onOk={async (naam) => {
            const { item } = await driveApi<{ item: DriveItem }>('/api/drive/mappen', 'POST', { ouder: inhoud.map.id, naam });
            setInhoud((i) => (i ? { ...i, items: [...i.items, item].sort(sorteer) } : i));
            setNieuweMap(false);
          }}
        />
      )}
      {hernoem && (
        <NaamDialoog
          titel={hernoem.map ? 'Map hernoemen' : 'Bestand hernoemen'}
          label="Nieuwe naam"
          start={hernoem.naam}
          knop="Opslaan"
          onAnnuleer={() => setHernoem(null)}
          onOk={async (naam) => {
            const { item } = await driveApi<{ item: DriveItem }>(`/api/drive/bestanden/${encodeURIComponent(hernoem.id)}`, 'PATCH', { naam });
            const vervang = (l: DriveItem[]) => l.map((x) => (x.id === item.id ? item : x)).sort(sorteer);
            setInhoud((i) => (i ? { ...i, items: vervang(i.items) } : i));
            setResultaten((r) => (r ? vervang(r) : r));
            setHernoem(null);
          }}
        />
      )}
      {weg && (
        <BevestigDialoog
          titel={weg.map ? 'Map verwijderen?' : 'Bestand verwijderen?'}
          tekst={`"${weg.naam}"${weg.map ? ' en alles erin' : ''} gaat naar de prullenbak van Google Drive. Daar is het nog 30 dagen terug te halen.`}
          knop="Naar prullenbak"
          gevaar
          onNee={() => setWeg(null)}
          onJa={async () => {
            const item = weg;
            setWeg(null);
            try {
              await driveApi(`/api/drive/bestanden/${encodeURIComponent(item.id)}`, 'DELETE');
              setInhoud((i) => (i ? { ...i, items: i.items.filter((x) => x.id !== item.id) } : i));
              setResultaten((r) => (r ? r.filter((x) => x.id !== item.id) : r));
              setMelding(`"${item.naam}" staat in de prullenbak van Google Drive.`);
              setTimeout(() => setMelding(null), 4000);
            } catch (e) {
              setFout({ tekst: e instanceof Error ? e.message : 'Verwijderen mislukt.' });
            }
          }}
        />
      )}
    </div>
  );
}

function Acties({
  item,
  beschermd,
  onHernoem,
  onWeg,
  compact = false
}: {
  item: DriveItem;
  beschermd: boolean;
  onHernoem: (i: DriveItem) => void;
  onWeg: (i: DriveItem) => void;
  compact?: boolean;
}) {
  return (
    <span className="bs-acties">
      {!item.map && (
        <a className="bs-icoonknop" href={inhoudUrl(item.id, true)} download title="Downloaden" aria-label={`${item.naam} downloaden`}>
          <BsIcoon naam="download" grootte={16} />
        </a>
      )}
      {!compact && item.link && (
        <a
          className="bs-icoonknop"
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in Google Drive (alleen met het Google-account van Studio Levant)"
          aria-label={`${item.naam} openen in Google Drive`}
        >
          <BsIcoon naam="extern" grootte={16} />
        </a>
      )}
      {!beschermd && (
        <>
          <button type="button" className="bs-icoonknop" title="Hernoemen" aria-label={`${item.naam} hernoemen`} onClick={() => onHernoem(item)}>
            <BsIcoon naam="pen" grootte={16} />
          </button>
          <button type="button" className="bs-icoonknop bs-gevaar" title="Verwijderen" aria-label={`${item.naam} verwijderen`} onClick={() => onWeg(item)}>
            <BsIcoon naam="prullenbak" grootte={16} />
          </button>
        </>
      )}
    </span>
  );
}
