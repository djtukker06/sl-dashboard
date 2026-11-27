'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import {
  CARROUSEL_MAX,
  MAX_CAPTION,
  MAX_TITEL,
  MAX_COLLABORATORS,
  MAX_GEBRUIKERSTAGS,
  MAX_HASHTAGS,
  PLATFORM_LABEL,
  SOORTEN,
  SOORTEN_PER_PLATFORM,
  SOORT_LABEL,
  STATUS_LABEL,
  aantalTekens,
  amsterdamNaarUtc,
  captionSamenstellen,
  controleerBestand,
  formatGepland,
  isBewerkbaar,
  normaliseerHashtags,
  parsePost,
  utcNaarAmsterdam
} from '@/lib/social/kern';
import { foutenPerVeld, snelkeuzes, soortNaToevoegen, splitsNamen, standaardMoment, verplaats, type EditorVeld } from '@/lib/social/weergave';
import type {
  AccountDto,
  GebruikersTag,
  HashtagsPlek,
  MediaDto,
  MediaMeta,
  Platform,
  PostAntwoord,
  PostDto,
  PostInvoer,
  PostSoort,
  UploadUrlAntwoord
} from '@/lib/social/types';
import { ApiFout, api, foutTekst } from './api';
import { PlatformIcoon } from './Iconen';
import { MediaVeld, type UploadItem } from './MediaVeld';
import { StatusPil } from './StatusPil';
import { Voorbeeld, type VoorbeeldMedia } from './Voorbeeld';
import { alsJpeg, leesMeta, putMetVoortgang } from './upload';

type Bezig = null | 'opslaan' | 'inplannen' | 'nu' | 'verwijderen' | 'notities';

// Editor van een post (/social/nieuw en /social/[id]): kanalen, soort, media, caption,
// hashtags, eerste reactie, tags, collab, locatie, eigen tekst per kanaal en het tijdstip
// (Europe/Amsterdam). Rechts een live voorbeeld. De controle is dezelfde als op de server
// (parsePost uit lib/social/kern.ts); meldingen staan onder het veld waar ze bij horen.
//
// Een nieuwe post bestaat pas na de eerste keer opslaan; het eerste bestand dat je toevoegt,
// slaat hem eerst op als concept (de upload heeft een post-id nodig). De URL wordt dan
// /social/<id> zonder de pagina opnieuw te laden.
export function Editor(props: { accounts: AccountDto[]; post: PostDto | null; startDatum: string | null; melding: string | null }) {
  return (
    <ToastProvider>
      <EditorInhoud {...props} />
    </ToastProvider>
  );
}

const mimeVan = (f: File): string => {
  if (f.type) return f.type === 'image/jpg' ? 'image/jpeg' : f.type;
  const ext = f.name.toLowerCase().split('.').pop();
  return ext === 'mov' ? 'video/quicktime' : ext === 'mp4' ? 'video/mp4' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : '';
};

const metaVan = (m: MediaDto): MediaMeta => ({ type: m.type, mime: m.mime, breedte: m.breedte, hoogte: m.hoogte, duur_sec: m.duur_sec, grootte: m.grootte });

function EditorInhoud({ accounts, post: begin, startDatum, melding }: { accounts: AccountDto[]; post: PostDto | null; startDatum: string | null; melding: string | null }) {
  const toast = useToast();
  const router = useRouter();
  const [post, setPost] = useState<PostDto | null>(begin);
  const postId = useRef<string | null>(begin?.id ?? null);
  const aanmaken = useRef<Promise<string> | null>(null);

  const [nu, setNu] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNu(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const bruikbaar = useMemo(() => accounts.filter((a) => a.actief), [accounts]);
  const [kanalen, setKanalen] = useState<string[]>(() =>
    begin ? begin.kanalen.map((k) => k.account_id) : bruikbaar.filter((a) => !a.fout).map((a) => a.id)
  );
  const [eigen, setEigen] = useState<Record<string, string>>(() => Object.fromEntries((begin?.kanalen ?? []).map((k) => [k.account_id, k.caption_eigen ?? ''])));
  const [eigenOpen, setEigenOpen] = useState<boolean>(() => !!begin?.kanalen.some((k) => k.caption_eigen));
  const [soort, setSoort] = useState<PostSoort>(begin?.soort ?? 'foto');
  const [titel, setTitel] = useState(begin?.titel ?? '');
  const [caption, setCaption] = useState(begin?.caption ?? '');
  const [hashtags, setHashtags] = useState(begin?.hashtags ?? '');
  const [plek, setPlek] = useState<HashtagsPlek>(begin?.hashtags_plek ?? 'caption');
  const [reactie, setReactie] = useState(begin?.eerste_reactie ?? '');
  const [tags, setTags] = useState<GebruikersTag[]>(begin?.gebruikers_tags ?? []);
  const [collab, setCollab] = useState((begin?.collaborators ?? []).join(', '));
  const [locatieNaam, setLocatieNaam] = useState(begin?.locatie_naam ?? '');
  const [locatieId, setLocatieId] = useState(begin?.locatie_id ?? '');
  const startMoment = useMemo(
    () => (begin?.gepland_op ? utcNaarAmsterdam(begin.gepland_op) : standaardMoment(new Date(), startDatum)),
    // Alleen bij het openen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [datum, setDatum] = useState(startMoment.datum);
  const [tijd, setTijd] = useState(startMoment.tijd);
  const [notities, setNotities] = useState(begin?.notities ?? '');
  const [media, setMedia] = useState<MediaDto[]>(begin?.media ?? []);
  const [lokaal, setLokaal] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [serverFouten, setServerFouten] = useState<string[]>([]);
  const [waarschuwingen, setWaarschuwingen] = useState<string[]>([]);
  const [poging, setPoging] = useState(false);
  const [bezig, setBezig] = useState<Bezig>(null);
  const [gewijzigd, setGewijzigd] = useState(false);
  const [vbPlatform, setVbPlatform] = useState<Platform | null>(null);
  const [tagNaam, setTagNaam] = useState('');
  const [tagBestand, setTagBestand] = useState(0);
  const [actieveTag, setActieveTag] = useState<number | null>(null);

  const bewerkbaar = !post || isBewerkbaar(post.status);
  const status = post?.status ?? 'concept';
  const gekozen = accounts.filter((a) => kanalen.includes(a.id));
  const platforms = [...new Set(gekozen.map((a) => a.platform))];
  const geplandOp = datum && tijd ? (amsterdamNaarUtc(datum, tijd)?.toISOString() ?? null) : null;

  // Niet zomaar weg met onopgeslagen wijzigingen of een lopende upload.
  useEffect(() => {
    if (!gewijzigd && !uploads.some((u) => !u.fout)) return;
    const waarschuw = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', waarschuw);
    return () => window.removeEventListener('beforeunload', waarschuw);
  }, [gewijzigd, uploads]);

  // Lokale voorbeeld-URL's opruimen bij het verlaten.
  const lokaalRef = useRef(lokaal);
  useEffect(() => {
    lokaalRef.current = lokaal;
  }, [lokaal]);
  useEffect(() => () => Object.values(lokaalRef.current).forEach((u) => URL.revokeObjectURL(u)), []);

  const wijzig = <T,>(zet: (w: T) => void) => (w: T) => {
    zet(w);
    setGewijzigd(true);
  };

  const invoer = useCallback(
    (s: 'concept' | 'ingepland'): PostInvoer => ({
      status: s,
      soort,
      titel,
      caption,
      eerste_reactie: reactie,
      hashtags,
      hashtags_plek: plek,
      locatie_id: locatieId.trim() || null,
      locatie_naam: locatieNaam.trim() || null,
      gebruikers_tags: tags,
      collaborators: splitsNamen(collab),
      gepland_op: geplandOp,
      notities,
      kanalen: kanalen.map((id) => ({ account_id: id, caption_eigen: eigen[id]?.trim() ? eigen[id] : null }))
    }),
    [soort, titel, caption, reactie, hashtags, plek, locatieId, locatieNaam, tags, collab, geplandOp, notities, kanalen, eigen]
  );

  const parseAccounts = useMemo(() => accounts.map((a) => ({ id: a.id, platform: a.platform, actief: a.actief })), [accounts]);
  const controle = useMemo(
    () => parsePost(invoer('ingepland'), { nu, accounts: parseAccounts, media: media.map(metaVan) }),
    [invoer, nu, parseAccounts, media]
  );
  const nogNodig = controle.ok ? [] : controle.fouten;
  const perVeld = foutenPerVeld(poging ? [...new Set([...serverFouten, ...nogNodig])] : serverFouten);
  const veldFout = (v: EditorVeld) =>
    perVeld[v]?.length ? (
      <ul className="so-veldfout" role="alert">
        {perVeld[v]!.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    ) : null;

  function zetPost(p: PostDto) {
    setPost(p);
    postId.current = p.id;
    setMedia(p.media);
    setHashtags(p.hashtags);
    if (window.location.pathname === '/social/nieuw') window.history.replaceState(null, '', `/social/${p.id}`);
  }

  /** Een post-id, zo nodig door de post eerst als concept op te slaan (voor uploads). */
  async function zorgVoorPost(): Promise<string> {
    if (postId.current) return postId.current;
    if (!aanmaken.current) {
      aanmaken.current = api<PostAntwoord>('/api/social/posts', { method: 'POST', body: invoer('concept') })
        .then((r) => {
          zetPost(r.post);
          return r.post.id;
        })
        .finally(() => {
          aanmaken.current = null;
        });
    }
    return aanmaken.current;
  }

  async function opslaan(s: 'concept' | 'ingepland'): Promise<PostDto | null> {
    if (s === 'ingepland' && !controle.ok) {
      setPoging(true);
      toast(controle.fout, { fout: true });
      return null;
    }
    setBezig(s === 'ingepland' ? 'inplannen' : 'opslaan');
    try {
      const body = invoer(s);
      const r = postId.current
        ? await api<PostAntwoord>(`/api/social/posts/${postId.current}`, { method: 'PATCH', body })
        : await api<PostAntwoord>('/api/social/posts', { method: 'POST', body });
      zetPost(r.post);
      setServerFouten([]);
      setWaarschuwingen(r.waarschuwingen ?? []);
      setGewijzigd(false);
      if (s === 'ingepland' && r.post.gepland_op) {
        toast(`Ingepland voor ${formatGepland(r.post.gepland_op, new Date())}.`, { actie: { label: 'Naar overzicht', onClick: () => router.push('/social') } });
      } else {
        toast('Opgeslagen als concept.');
      }
      return r.post;
    } catch (e) {
      if (e instanceof ApiFout && e.fouten.length) {
        setServerFouten(e.fouten);
        setPoging(true);
      }
      toast(foutTekst(e), { fout: true });
      return null;
    } finally {
      setBezig(null);
    }
  }

  async function nuPlaatsen() {
    // Een datum is voor "nu" niet nodig; alleen de andere meldingen tellen. Bij een deels
    // geplaatste post ligt de inhoud vast: dan alleen de mislukte kanalen opnieuw.
    const zonderTijd = controle.ok || status === 'deels' ? [] : controle.fouten.filter((f) => !/datum|tijd|verleden|vooruit/i.test(f));
    if (zonderTijd.length) {
      setPoging(true);
      toast(zonderTijd[0], { fout: true });
      return;
    }
    const namen =
      status === 'deels'
        ? (post?.kanalen ?? []).filter((k) => k.status !== 'geplaatst').map((k) => `${k.account_naam} (${PLATFORM_LABEL[k.platform]})`).join(', ')
        : gekozen.map((a) => `${a.naam} (${PLATFORM_LABEL[a.platform]})`).join(', ');
    if (!window.confirm(`Nu plaatsen op ${namen}? Dit kun je niet terugdraaien vanuit het dashboard.`)) return;
    const opgeslagen = status === 'deels' ? postId.current : await opslaanStil();
    if (!opgeslagen) return;
    setBezig('nu');
    try {
      const r = await api<{ status: 'geplaatst' | 'deels' | 'mislukt'; fouten: string[]; post: PostDto | null }>(`/api/social/posts/${opgeslagen}/nu`, { method: 'POST' });
      if (r.post) zetPost(r.post);
      setGewijzigd(false);
      if (r.status === 'geplaatst') toast('Geplaatst.', { actie: { label: 'Naar overzicht', onClick: () => router.push('/social') } });
      else if (r.status === 'deels') toast(`Deels geplaatst: ${r.fouten[0] ?? 'een kanaal is mislukt.'}`, { fout: true, duur: 8000 });
      else toast(r.fouten[0] ?? 'Plaatsen is niet gelukt.', { fout: true, duur: 8000 });
    } catch (e) {
      if (e instanceof ApiFout && e.fouten.length) {
        setServerFouten(e.fouten);
        setPoging(true);
      }
      toast(foutTekst(e), { fout: true });
    } finally {
      setBezig(null);
    }
  }

  /** Opslaan als concept zonder melding (vóór "Nu plaatsen"). Geeft de post-id. */
  async function opslaanStil(): Promise<string | null> {
    setBezig('opslaan');
    try {
      const body = { ...invoer('concept'), gepland_op: geplandOp };
      const r = postId.current
        ? await api<PostAntwoord>(`/api/social/posts/${postId.current}`, { method: 'PATCH', body })
        : await api<PostAntwoord>('/api/social/posts', { method: 'POST', body });
      zetPost(r.post);
      return r.post.id;
    } catch (e) {
      if (e instanceof ApiFout && e.fouten.length) setServerFouten(e.fouten);
      toast(foutTekst(e), { fout: true });
      return null;
    } finally {
      setBezig(null);
    }
  }

  async function verwijderen(definitief: boolean) {
    if (!postId.current) {
      router.push('/social');
      return;
    }
    const vraag = !definitief
      ? 'De inplanning annuleren? De post wordt dan niet geplaatst en blijft als concept staan.'
      : post?.status === 'geplaatst' || post?.status === 'deels'
        ? 'Deze post uit het dashboard verwijderen? Op Instagram en Facebook blijft hij gewoon staan; de cijfers zijn hier daarna weg.'
        : 'Deze post en zijn bestanden definitief verwijderen?';
    if (!window.confirm(vraag)) return;
    setBezig('verwijderen');
    try {
      const r = await api<{ ok: true; geannuleerd: boolean; post?: PostDto }>(`/api/social/posts/${postId.current}${definitief ? '?definitief=1' : ''}`, { method: 'DELETE' });
      if (r.geannuleerd && r.post) {
        zetPost(r.post);
        toast('Inplanning geannuleerd; de post staat nu als concept.');
      } else {
        setGewijzigd(false);
        toast('Verwijderd.');
        router.push('/social');
      }
    } catch (e) {
      toast(foutTekst(e), { fout: true });
    } finally {
      setBezig(null);
    }
  }

  async function notitiesOpslaan() {
    if (!postId.current) return;
    setBezig('notities');
    try {
      const r = await api<PostAntwoord>(`/api/social/posts/${postId.current}`, { method: 'PATCH', body: { notities } });
      zetPost(r.post);
      setGewijzigd(false);
      toast('Notities opgeslagen.');
    } catch (e) {
      toast(foutTekst(e), { fout: true });
    } finally {
      setBezig(null);
    }
  }

  // ---------------- media ----------------

  async function voegToe(bestanden: File[]) {
    if (!bewerkbaar || !bestanden.length) return;
    const ruimte = CARROUSEL_MAX - media.length - uploads.filter((u) => !u.fout).length;
    if (ruimte <= 0) {
      toast(`Een post heeft max. ${CARROUSEL_MAX} bestanden.`, { fout: true });
      return;
    }
    const lijst = bestanden.slice(0, ruimte);
    if (lijst.length < bestanden.length) toast(`Alleen de eerste ${ruimte} bestanden; een post heeft max. ${CARROUSEL_MAX}.`, { fout: true });

    const items: UploadItem[] = lijst.map((f, n) => ({ sleutel: `${Date.now()}-${n}-${f.name}`, naam: f.name, voortgang: 0, fout: null }));
    setUploads((u) => [...u, ...items]);
    const zetItem = (sleutel: string, w: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.sleutel === sleutel ? { ...x, ...w } : x)));

    const metas = await Promise.all(lijst.map((f) => leesMeta(f, mimeVan(f)).catch(() => null)));
    const nieuweSoort = soortNaToevoegen(
      soort,
      media,
      metas.filter((m): m is MediaMeta => !!m)
    );
    if (nieuweSoort !== soort) {
      setSoort(nieuweSoort);
      toast(`Soort aangepast naar ${SOORT_LABEL[nieuweSoort].toLowerCase()}.`);
    }

    // Eén voor één, zodat de volgorde gelijk blijft aan de gekozen volgorde.
    let bekend = new Set(media.map((m) => m.id));
    for (const [n, f] of lijst.entries()) {
      const item = items[n];
      const meta = metas[n];
      if (!meta || !meta.mime) {
        zetItem(item.sleutel, { fout: 'Dit bestand kan niet worden gelezen. Gebruik JPEG, PNG, MP4 of MOV.' });
        continue;
      }
      try {
        const klaar = meta.type === 'afbeelding' ? await alsJpeg(f, meta) : { blob: f as Blob, naam: f.name, mime: meta.mime, meta };
        const check = controleerBestand(klaar.meta, nieuweSoort, platforms);
        if (check.fouten.length) {
          zetItem(item.sleutel, { fout: check.fouten[0] });
          continue;
        }
        const id = await zorgVoorPost();
        const doel = await api<UploadUrlAntwoord>('/api/social/media/upload-url', {
          method: 'POST',
          body: { post_id: id, bestandsnaam: klaar.naam, mime: klaar.mime, grootte: klaar.blob.size }
        });
        await putMetVoortgang(doel.signedUrl, klaar.blob, klaar.mime, (v) => zetItem(item.sleutel, { voortgang: v }));
        const r = await api<PostAntwoord>(`/api/social/posts/${id}/media`, { method: 'POST', body: { pad: doel.pad, ...klaar.meta } });
        const nieuw = r.post.media.find((m) => !bekend.has(m.id));
        if (nieuw) setLokaal((l) => ({ ...l, [nieuw.id]: URL.createObjectURL(klaar.blob) }));
        bekend = new Set(r.post.media.map((m) => m.id));
        setMedia(r.post.media);
        setPost(r.post);
        if (r.waarschuwingen?.length) setWaarschuwingen((w) => [...new Set([...w, ...r.waarschuwingen!])]);
        setUploads((u) => u.filter((x) => x.sleutel !== item.sleutel));
      } catch (e) {
        zetItem(item.sleutel, { fout: foutTekst(e) });
      }
    }
  }

  async function mediaWeg(m: MediaDto) {
    const index = media.findIndex((x) => x.id === m.id);
    try {
      const r = await api<{ ok: true; post: PostDto }>(`/api/social/media/${m.id}`, { method: 'DELETE' });
      setMedia(r.post.media);
      if (lokaal[m.id]) {
        URL.revokeObjectURL(lokaal[m.id]);
        setLokaal((l) => {
          const kopie = { ...l };
          delete kopie[m.id];
          return kopie;
        });
      }
      // Tags op dit bestand vervallen, die op latere bestanden schuiven een plek op.
      setTags((t) => t.filter((x) => x.media_index !== index).map((x) => (x.media_index > index ? { ...x, media_index: x.media_index - 1 } : x)));
    } catch (e) {
      toast(foutTekst(e), { fout: true });
    }
  }

  async function mediaVerplaats(van: number, naar: number) {
    const oud = media;
    const nieuw = verplaats(media, van, naar);
    if (nieuw === media || !postId.current) return;
    setMedia(nieuw);
    setTags((t) => t.map((x) => ({ ...x, media_index: Math.max(0, nieuw.findIndex((m) => m.id === oud[x.media_index]?.id)) })));
    try {
      const r = await api<PostAntwoord>(`/api/social/posts/${postId.current}/media`, { method: 'POST', body: { volgorde: nieuw.map((m) => m.id) } });
      setMedia(r.post.media);
    } catch (e) {
      setMedia(oud);
      toast(foutTekst(e), { fout: true });
    }
  }

  async function altOpslaan(m: MediaDto, tekst: string) {
    if (!postId.current || tekst === m.alt_tekst) return;
    try {
      const r = await api<PostAntwoord>(`/api/social/posts/${postId.current}/media`, { method: 'POST', body: { media_id: m.id, alt_tekst: tekst } });
      setMedia(r.post.media);
    } catch (e) {
      toast(foutTekst(e), { fout: true });
    }
  }

  // ---------------- afgeleid ----------------

  const ht = normaliseerHashtags(hashtags);
  const samengesteld = captionSamenstellen({ caption, hashtags: ht.tekst, hashtags_plek: plek, eerste_reactie: reactie });
  const captionTekens = aantalTekens(samengesteld.caption);
  const afbeeldingen = media.map((m, i) => ({ m, i })).filter(({ m }) => m.type === 'afbeelding');
  const vbKeuze = vbPlatform && platforms.includes(vbPlatform) ? vbPlatform : (platforms[0] ?? 'instagram');
  const vbAccount = gekozen.find((a) => a.platform === vbKeuze) ?? null;
  const vbMedia: VoorbeeldMedia[] = media.map((m) => ({ sleutel: m.id, type: m.type, url: lokaal[m.id] ?? m.url, breedte: m.breedte, hoogte: m.hoogte, alt: m.alt_tekst }));
  const vbCaption = vbAccount && eigen[vbAccount.id]?.trim() ? captionSamenstellen({ caption, hashtags: ht.tekst, hashtags_plek: plek, eerste_reactie: reactie }, eigen[vbAccount.id]) : samengesteld;
  const snel = snelkeuzes(nu);
  const momentTekst = geplandOp ? formatGepland(geplandOp, nu) : null;
  const kanTekst = platforms.every((p) => SOORTEN_PER_PLATFORM[p].includes('tekst'));
  const alles = bezig !== null;

  function toggleKanaal(a: AccountDto) {
    setGewijzigd(true);
    setKanalen((k) => (k.includes(a.id) ? k.filter((x) => x !== a.id) : [...k, a.id]));
  }

  function tagToevoegen() {
    const naam = tagNaam.trim().replace(/^@+/, '');
    if (!naam) return;
    if (tags.length >= MAX_GEBRUIKERSTAGS) {
      toast(`Max. ${MAX_GEBRUIKERSTAGS} getagde personen.`, { fout: true });
      return;
    }
    const index = afbeeldingen.some(({ i }) => i === tagBestand) ? tagBestand : (afbeeldingen[0]?.i ?? 0);
    setTags((t) => [...t, { gebruikersnaam: naam, x: 0.5, y: 0.5, media_index: index }]);
    setActieveTag(tags.length);
    setTagNaam('');
    setGewijzigd(true);
  }

  function tagPlaatsen(e: React.MouseEvent<HTMLElement>) {
    if (actieveTag == null) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setTags((t) => t.map((tag, n) => (n === actieveTag ? { ...tag, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } : tag)));
    setGewijzigd(true);
  }

  const tagBeeld = actieveTag != null ? media[tags[actieveTag]?.media_index ?? -1] : null;

  return (
    <div className="so-editor">
      {melding && (
        <p className="so-melding" role="status">
          <strong>Social is nog niet ingericht.</strong> {melding}
        </p>
      )}

      <div className="so-editor-kolommen">
        <div className="so-editor-velden">
          {post && (
            <div className="so-editor-status">
              <StatusPil status={post.status} />
              <span className="so-zacht">
                {post.geplaatst_op
                  ? `Geplaatst ${formatGepland(post.geplaatst_op, nu)}`
                  : post.status === 'ingepland' && post.gepland_op
                    ? `Wordt geplaatst ${formatGepland(post.gepland_op, nu)}`
                    : STATUS_LABEL[post.status]}
              </span>
              {post.bron === 'extern' && <span className="so-zacht">· buiten het dashboard geplaatst</span>}
            </div>
          )}

          {post && post.kanalen.some((k) => k.fout || k.permalink || k.status !== post.status) && (
            <ul className="so-kanaalstatus">
              {post.kanalen.map((k) => (
                <li key={k.id}>
                  <PlatformIcoon platform={k.platform} grootte={14} />
                  <span>{k.account_naam}</span>
                  <StatusPil status={k.status} />
                  {k.permalink && (
                    <a href={k.permalink} target="_blank" rel="noopener noreferrer" className="ag-link-knop">
                      Bekijk op {PLATFORM_LABEL[k.platform]}
                    </a>
                  )}
                  {k.fout && <span className="so-fouttekst">{k.fout}</span>}
                  {k.status === 'ingepland' && k.pogingen > 0 && k.volgende_poging_op && (
                    <span className="so-zacht">Nieuwe poging {formatGepland(k.volgende_poging_op, nu)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <fieldset className="so-sectie" disabled={!bewerkbaar}>
            <legend className="db-label">Titel</legend>
            <label className="ag-label">
              <span className="so-label-rij">
                Alleen voor jezelf: in de lijst en de kalender
                <span className={`so-teller${[...titel].length > MAX_TITEL ? ' is-te-veel' : ''}`}>
                  {[...titel].length}/{MAX_TITEL}
                </span>
              </span>
              <input
                className="ag-veld"
                type="text"
                value={titel}
                maxLength={MAX_TITEL}
                onChange={(e) => wijzig(setTitel)(e.target.value)}
                placeholder="Bijv. Lancering website Bakkerij Jansen"
              />
            </label>
            {veldFout('titel')}
          </fieldset>

          <fieldset className="so-sectie" disabled={!bewerkbaar}>
            <legend className="db-label">Kanalen</legend>
            {accounts.length === 0 ? (
              <p className="so-zacht">
                Nog geen kanaal gekoppeld. <Link href="/social/koppelingen">Koppel Instagram of Facebook</Link> om te kunnen plaatsen; een concept opslaan kan al wel.
              </p>
            ) : (
              <div className="so-accounts">
                {accounts.map((a) => {
                  const aan = kanalen.includes(a.id);
                  const kapot = !a.actief || !!a.fout;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`so-account${aan ? ' is-aan' : ''}${kapot ? ' is-kapot' : ''}`}
                      aria-pressed={aan}
                      onClick={() => toggleKanaal(a)}
                      disabled={!a.actief && !aan}
                    >
                      <span className="so-account-foto" aria-hidden="true">
                        {a.afbeelding_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- profielfoto van Meta
                          <img src={a.afbeelding_url} alt="" />
                        ) : (
                          <PlatformIcoon platform={a.platform} grootte={16} />
                        )}
                        <span className="so-account-platform">
                          <PlatformIcoon platform={a.platform} grootte={10} />
                        </span>
                      </span>
                      <span className="so-account-tekst">
                        <strong>{a.naam || a.gebruikersnaam}</strong>
                        <span className="so-zacht">{kapot ? 'Opnieuw koppelen nodig' : a.gebruikersnaam ? `@${a.gebruikersnaam}` : PLATFORM_LABEL[a.platform]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {accounts.some((a) => a.fout || !a.actief) && (
              <p className="so-zacht">
                Een account moet opnieuw gekoppeld worden: <Link href="/social/koppelingen">naar Koppelingen</Link>.
              </p>
            )}
            {veldFout('kanalen')}
          </fieldset>

          <fieldset className="so-sectie" disabled={!bewerkbaar}>
            <legend className="db-label">Soort</legend>
            <div className="ag-segment so-soorten" role="group" aria-label="Soort post">
              {SOORTEN.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={soort === s ? 'is-aan' : ''}
                  aria-pressed={soort === s}
                  disabled={s === 'tekst' && !kanTekst}
                  title={s === 'tekst' && !kanTekst ? 'Alleen voor Facebook: Instagram heeft altijd een foto of video nodig.' : undefined}
                  onClick={() => wijzig(setSoort)(s)}
                >
                  {s === 'tekst' ? 'Tekst (Facebook)' : SOORT_LABEL[s]}
                </button>
              ))}
            </div>
            {veldFout('soort')}
          </fieldset>

          {soort !== 'tekst' && (
            <fieldset className="so-sectie" disabled={!bewerkbaar}>
              <legend className="db-label">
                {soort === 'reel' ? 'Video' : soort === 'carrousel' ? `Bestanden (2–${CARROUSEL_MAX})` : 'Afbeelding'}
              </legend>
              <MediaVeld
                soort={soort}
                media={media}
                lokaal={lokaal}
                uploads={uploads}
                bewerkbaar={bewerkbaar}
                onBestanden={(f) => void voegToe(f)}
                onWeg={(m) => void mediaWeg(m)}
                onVerplaats={(a, b) => void mediaVerplaats(a, b)}
                onAlt={(m, t) => void altOpslaan(m, t)}
                onUploadWeg={(s) => setUploads((u) => u.filter((x) => x.sleutel !== s))}
              />
              {veldFout('media')}
            </fieldset>
          )}

          <fieldset className="so-sectie" disabled={!bewerkbaar}>
            <legend className="db-label">Caption</legend>
            <label className="ag-label">
              <span className="so-label-rij">
                Tekst
                <span className={`so-teller${captionTekens > MAX_CAPTION ? ' is-te-veel' : ''}`}>
                  {captionTekens}/{MAX_CAPTION}
                </span>
              </span>
              <textarea className="ag-veld so-caption" rows={7} value={caption} onChange={(e) => wijzig(setCaption)(e.target.value)} placeholder="Schrijf de caption… (@naam om iemand te noemen)" />
            </label>
            {veldFout('caption')}

            <label className="ag-label">
              <span className="so-label-rij">
                Hashtags
                <span className={`so-teller${ht.tags.length > MAX_HASHTAGS ? ' is-te-veel' : ''}`}>
                  {ht.tags.length}/{MAX_HASHTAGS}
                </span>
              </span>
              <input
                className="ag-veld"
                value={hashtags}
                onChange={(e) => wijzig(setHashtags)(e.target.value)}
                onBlur={() => ht.ongeldig.length === 0 && setHashtags(ht.tekst)}
                placeholder="#studiolevant #interieur"
              />
            </label>
            <div className="so-rij">
              <span className="so-zacht">Hashtags komen</span>
              <div className="ag-segment" role="group" aria-label="Plek van de hashtags">
                <button type="button" className={plek === 'caption' ? 'is-aan' : ''} aria-pressed={plek === 'caption'} onClick={() => wijzig(setPlek)('caption')}>
                  onder de caption
                </button>
                <button type="button" className={plek === 'reactie' ? 'is-aan' : ''} aria-pressed={plek === 'reactie'} onClick={() => wijzig(setPlek)('reactie')}>
                  in de eerste reactie
                </button>
              </div>
            </div>
            {veldFout('hashtags')}

            <label className="ag-label">
              Eerste reactie (optioneel)
              <textarea className="ag-veld" rows={2} value={reactie} onChange={(e) => wijzig(setReactie)(e.target.value)} placeholder="Wordt direct na het plaatsen als reactie geplaatst" />
            </label>
            {veldFout('reactie')}

            {kanalen.length > 1 && (
              <details className="so-eigen" open={eigenOpen} onToggle={(e) => setEigenOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary>Andere tekst per kanaal</summary>
                {gekozen.map((a) => (
                  <label key={a.id} className="ag-label">
                    <span className="so-label-rij">
                      <span>
                        <PlatformIcoon platform={a.platform} grootte={12} /> {a.naam}
                      </span>
                      {eigen[a.id]?.trim() && <span className="so-teller">{aantalTekens(eigen[a.id])}</span>}
                    </span>
                    <textarea
                      className="ag-veld"
                      rows={3}
                      value={eigen[a.id] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEigen((x) => ({ ...x, [a.id]: v }));
                        setGewijzigd(true);
                      }}
                      placeholder="Leeg = dezelfde caption"
                    />
                  </label>
                ))}
              </details>
            )}
          </fieldset>

          {platforms.includes('instagram') && soort !== 'tekst' && (
            <fieldset className="so-sectie" disabled={!bewerkbaar}>
              <legend className="db-label">Personen en samenwerking (Instagram)</legend>
              <div className="so-rij so-rij-velden">
                <label className="ag-label so-groei">
                  Persoon taggen
                  <input
                    className="ag-veld"
                    value={tagNaam}
                    onChange={(e) => setTagNaam(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        tagToevoegen();
                      }
                    }}
                    placeholder="@gebruikersnaam"
                  />
                </label>
                {afbeeldingen.length > 1 && (
                  <label className="ag-label">
                    Op
                    <select className="ag-veld" value={tagBestand} onChange={(e) => setTagBestand(Number(e.target.value))}>
                      {afbeeldingen.map(({ i }) => (
                        <option key={i} value={i}>
                          Bestand {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" className="db-knop" onClick={tagToevoegen} disabled={!tagNaam.trim() || !afbeeldingen.length}>
                  Taggen
                </button>
              </div>
              {!afbeeldingen.length && <p className="so-zacht">Taggen kan op een afbeelding; voeg eerst een afbeelding toe.</p>}
              {tags.length > 0 && (
                <ul className="so-tags">
                  {tags.map((t, n) => (
                    <li key={`${t.gebruikersnaam}-${t.media_index}-${n}`} className={actieveTag === n ? 'is-aan' : ''}>
                      <button type="button" className="ag-link-knop" onClick={() => setActieveTag(actieveTag === n ? null : n)}>
                        @{t.gebruikersnaam}
                        {afbeeldingen.length > 1 ? ` · bestand ${t.media_index + 1}` : ''}
                      </button>
                      <button
                        type="button"
                        className="ag-chip-x"
                        aria-label={`Tag @${t.gebruikersnaam} weghalen`}
                        onClick={() => {
                          setTags((x) => x.filter((_, i) => i !== n));
                          setActieveTag(null);
                          setGewijzigd(true);
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {tagBeeld && (lokaal[tagBeeld.id] || tagBeeld.url) && (
                <div className="so-tagvlak">
                  <p className="so-zacht">Klik op de foto waar @{tags[actieveTag!].gebruikersnaam} staat.</p>
                  <button type="button" className="so-tagbeeld" onClick={tagPlaatsen} aria-label="Plek van de tag kiezen">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed URL of lokaal voorbeeld */}
                    <img src={lokaal[tagBeeld.id] ?? tagBeeld.url ?? ''} alt="" />
                    {tags
                      .filter((t) => t.media_index === tags[actieveTag!].media_index)
                      .map((t) => (
                        <span key={t.gebruikersnaam} className="so-tagpunt" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}>
                          @{t.gebruikersnaam}
                        </span>
                      ))}
                  </button>
                </div>
              )}
              {veldFout('tags')}

              <label className="ag-label">
                <span className="so-label-rij">
                  Collab-accounts (max. {MAX_COLLABORATORS})
                  <span className="so-teller">{splitsNamen(collab).length}</span>
                </span>
                <input className="ag-veld" value={collab} onChange={(e) => wijzig(setCollab)(e.target.value)} placeholder="@partner, @klant" />
              </label>
              <p className="so-zacht">Zij krijgen een uitnodiging om de post samen te delen.</p>
              {veldFout('collaborators')}
            </fieldset>
          )}

          <fieldset className="so-sectie" disabled={!bewerkbaar}>
            <legend className="db-label">Locatie (optioneel)</legend>
            <div className="so-rij so-rij-velden">
              <label className="ag-label so-groei">
                Naam
                <input className="ag-veld" value={locatieNaam} onChange={(e) => wijzig(setLocatieNaam)(e.target.value)} placeholder="Bv. Studio Levant, Amsterdam" />
              </label>
              <label className="ag-label">
                Pagina-ID
                <input className="ag-veld" inputMode="numeric" value={locatieId} onChange={(e) => wijzig(setLocatieId)(e.target.value.replace(/\D/g, ''))} placeholder="123456789" />
              </label>
            </div>
            <p className="so-zacht">Instagram en Facebook koppelen een locatie via de ID van een Facebookpagina met een adres. Zonder ID wordt er geen locatie geplaatst.</p>
            {veldFout('locatie')}
          </fieldset>

          <fieldset className="so-sectie" disabled={!bewerkbaar}>
            <legend className="db-label">Wanneer</legend>
            <div className="so-rij so-rij-velden">
              <label className="ag-label">
                Datum
                <input className="ag-veld" type="date" value={datum} onChange={(e) => wijzig(setDatum)(e.target.value)} />
              </label>
              <label className="ag-label">
                Tijd
                <input className="ag-veld" type="time" step={300} value={tijd} onChange={(e) => wijzig(setTijd)(e.target.value)} />
              </label>
            </div>
            <div className="so-snel">
              {snel.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={`so-chip${datum === s.datum && tijd === s.tijd ? ' is-aan' : ''}`}
                  onClick={() => {
                    setDatum(s.datum);
                    setTijd(s.tijd);
                    setGewijzigd(true);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {momentTekst && <p className="so-moment">{momentTekst} <span className="so-zacht">(Nederlandse tijd; uiterlijk een paar minuten later online)</span></p>}
            {veldFout('tijd')}
          </fieldset>

          <fieldset className="so-sectie">
            <legend className="db-label">Notities (intern)</legend>
            <textarea className="ag-veld" rows={2} value={notities} onChange={(e) => wijzig(setNotities)(e.target.value)} placeholder="Alleen voor het team, wordt niet geplaatst" />
            {!bewerkbaar && (
              <div>
                <button type="button" className="db-knop" onClick={() => void notitiesOpslaan()} disabled={alles || !gewijzigd}>
                  {bezig === 'notities' ? 'Opslaan…' : 'Notities opslaan'}
                </button>
              </div>
            )}
            {veldFout('notities')}
          </fieldset>

          {(veldFout('algemeen') || waarschuwingen.length > 0) && (
            <div className="so-sectie">
              {veldFout('algemeen')}
              {waarschuwingen.length > 0 && (
                <ul className="so-waarschuwingen">
                  {waarschuwingen.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <aside className="so-editor-zij" aria-label="Voorbeeld">
          <div className="so-zij-plak">
            {platforms.length > 1 && (
              <div className="ag-segment" role="group" aria-label="Voorbeeld voor">
                {platforms.map((p) => (
                  <button key={p} type="button" className={vbKeuze === p ? 'is-aan' : ''} aria-pressed={vbKeuze === p} onClick={() => setVbPlatform(p)}>
                    {PLATFORM_LABEL[p]}
                  </button>
                ))}
              </div>
            )}
            <Voorbeeld
              platform={vbKeuze}
              naam={vbAccount?.gebruikersnaam || vbAccount?.naam || 'studiolevant'}
              afbeelding={vbAccount?.afbeelding_url ?? null}
              soort={soort}
              media={vbMedia}
              caption={vbCaption.caption}
              eersteReactie={vbCaption.eersteReactie}
              locatie={locatieId ? locatieNaam || null : null}
              collaborators={vbKeuze === 'instagram' ? splitsNamen(collab) : []}
            />
            {bewerkbaar && (
              <div className={`so-klaar${controle.ok ? ' is-ok' : ''}`}>
                {controle.ok ? (
                  <p>Klaar om in te plannen.</p>
                ) : (
                  <>
                    <p>Nog nodig om in te plannen:</p>
                    <ul>
                      {nogNodig.slice(0, 5).map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </>
                )}
                {controle.ok && controle.waarschuwingen.length > 0 && (
                  <ul className="so-waarschuwingen">
                    {controle.waarschuwingen.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="so-acties">
        {bewerkbaar ? (
          <>
            {status !== 'ingepland' && (
              <button type="button" className="db-knop" onClick={() => void opslaan('concept')} disabled={alles}>
                {bezig === 'opslaan' ? 'Opslaan…' : 'Opslaan als concept'}
              </button>
            )}
            <button type="button" className="db-knop db-knop-primair" onClick={() => void opslaan('ingepland')} disabled={alles || accounts.length === 0}>
              {bezig === 'inplannen' ? 'Inplannen…' : status === 'ingepland' ? 'Wijzigingen opslaan' : 'Inplannen'}
            </button>
            <button type="button" className="db-knop" onClick={() => void nuPlaatsen()} disabled={alles || accounts.length === 0 || kanalen.length === 0}>
              {bezig === 'nu' ? 'Plaatsen…' : status === 'mislukt' ? 'Opnieuw proberen' : 'Nu plaatsen'}
            </button>
          </>
        ) : (
          <>
            <Link className="db-knop" href="/social">
              Naar overzicht
            </Link>
            {status === 'deels' && (
              <button type="button" className="db-knop" onClick={() => void nuPlaatsen()} disabled={alles}>
                {bezig === 'nu' ? 'Plaatsen…' : 'Mislukte kanalen opnieuw proberen'}
              </button>
            )}
          </>
        )}
        <span className="so-acties-ruimte" />
        {post && status === 'ingepland' && (
          <button type="button" className="ag-link-knop" onClick={() => void verwijderen(false)} disabled={alles}>
            Inplanning annuleren
          </button>
        )}
        {post && status !== 'bezig' && (
          <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => void verwijderen(true)} disabled={alles}>
            Verwijderen
          </button>
        )}
      </div>
    </div>
  );
}
