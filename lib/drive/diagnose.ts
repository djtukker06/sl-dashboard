import 'server-only';
import type { TeamlidBewijs } from '@/lib/auth/team';
import { ontbrekendeEnv } from './config';
import { ALGEMEEN, BOEKHOUDING, boekhoudPad, DriveFout, foutTekst, jaarVan, KLANTEN, padSleutel } from './kern';
import { verbind, type Verbinding } from './koppeling';
import { zorgVoorPad } from './mappen';
import type { DiagnoseResultaat, DiagnoseStap } from './types';

// "Test Drive-koppeling" (knop in Bestanden, alleen de eigenaar): loopt de keten na die een
// factuurkopie ook doorloopt — env, koppeling + token verversen, rootmap, de vaste mappen
// (Boekhouding/Factuur, Boekhouding/Prijsopgaven|Bonnetjes/<dit jaar>, Klanten, Algemeen; aangemaakt als
// ze er nog niet zijn) en de tabellen — en meldt per stap OK of de fout. Er wordt geen
// bestand geüpload en geen factuur gemaakt. Elke stap komt ook in de logs ("[drive] diagnose").

function fout(naam: string, e: unknown): DiagnoseStap {
  return { naam, uitkomst: 'fout', tekst: e instanceof DriveFout ? `${e.message}${e.detail ? ` — ${e.detail}` : ''}` : foutTekst(e) };
}

const mapLink = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

export async function diagnoseDrive(bewijs: TeamlidBewijs, nu: Date = new Date()): Promise<DiagnoseResultaat> {
  const start = Date.now();
  const stappen: DiagnoseStap[] = [];
  const klaar = (): DiagnoseResultaat => {
    const r = { ok: stappen.every((s) => s.uitkomst !== 'fout'), stappen, duurMs: Date.now() - start };
    for (const s of stappen) {
      const regel = `[drive] diagnose ${s.naam}: ${s.uitkomst.toUpperCase()} ${s.tekst}`;
      if (s.uitkomst === 'fout') console.error(regel);
      else console.info(regel);
    }
    return r;
  };

  // 1. Server-instellingen
  const ontbreekt = ontbrekendeEnv();
  if (ontbreekt.length) {
    stappen.push({ naam: 'Instellingen op de server', uitkomst: 'fout', tekst: `Ontbreekt: ${ontbreekt.join(', ')}` });
    return klaar();
  }
  stappen.push({ naam: 'Instellingen op de server', uitkomst: 'ok', tekst: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en de sleutel staan er.' });

  // 2. Koppeling lezen en een access token ophalen (ververst met het refresh token)
  let v: Verbinding;
  try {
    v = await verbind(bewijs);
    const over = await v.client.over();
    const gebruik = Number(over.storageQuota?.usage ?? NaN);
    const limiet = Number(over.storageQuota?.limit ?? NaN);
    const opslag =
      Number.isFinite(gebruik) && Number.isFinite(limiet) && limiet > 0
        ? ` Opslag: ${(gebruik / 1e9).toFixed(1)} van ${(limiet / 1e9).toFixed(0)} GB (${Math.round((gebruik / limiet) * 100)}%).`
        : '';
    const email = over.user?.emailAddress || v.email;
    const ander = v.email && email && v.email.toLowerCase() !== email.toLowerCase() ? ` Let op: gekoppeld als ${v.email}.` : '';
    stappen.push({ naam: 'Toegang tot Google Drive', uitkomst: 'ok', tekst: `Ingelogd als ${email}.${opslag}${ander}` });
  } catch (e) {
    stappen.push(fout('Toegang tot Google Drive', e));
    return klaar();
  }

  // 3. De rootmap "Studio Levant"
  try {
    const root = await v.client.bestand(v.rootId, 'id,name,trashed');
    if (root.trashed) {
      stappen.push({ naam: 'Hoofdmap', uitkomst: 'fout', tekst: `"${root.name}" staat in de prullenbak van Drive. Zet hem terug (of koppel opnieuw).`, link: mapLink(v.rootId) });
      return klaar();
    }
    stappen.push({ naam: 'Hoofdmap', uitkomst: 'ok', tekst: `"${root.name}" bestaat.`, link: mapLink(v.rootId) });
  } catch (e) {
    stappen.push(fout('Hoofdmap', e));
    return klaar();
  }

  // 4. De vaste mappen (zoals een kopie ze gebruikt; bestaat er een niet, dan wordt hij aangemaakt)
  const { data: voor } = await v.service.from('drive_mappen').select('sleutel').eq('root_id', v.rootId).eq('soort', 'pad');
  const bekend = new Set(((voor ?? []) as { sleutel: string }[]).map((r) => r.sleutel));
  const jaar = jaarVan(nu);
  const paden: string[][] = [
    [BOEKHOUDING],
    boekhoudPad('factuur', jaar),
    boekhoudPad('prijsopgave', jaar),
    boekhoudPad('bonnetje', jaar),
    [KLANTEN],
    [ALGEMEEN]
  ];
  for (const pad of paden) {
    const naam = pad.join('/');
    try {
      const id = await zorgVoorPad(v, pad);
      stappen.push({
        naam,
        uitkomst: 'ok',
        tekst: bekend.has(padSleutel(pad)) ? 'Bestaat (gecontroleerd in Drive).' : 'Klaargezet (gevonden of aangemaakt) en onthouden.',
        link: mapLink(id)
      });
    } catch (e) {
      stappen.push(fout(naam, e));
    }
  }

  // 5. Vastleggen van kopieën (drive_kopieen) en de laatste factuur
  try {
    const { count, error } = await v.service.from('drive_kopieen').select('bron_id', { count: 'exact', head: true }).eq('root_id', v.rootId);
    if (error) throw new Error(error.message);
    stappen.push({ naam: 'Kopieën bijhouden', uitkomst: 'ok', tekst: `${count ?? 0} bestand(en) al naar Drive gekopieerd.` });
  } catch (e) {
    stappen.push(fout('Kopieën bijhouden', e));
  }
  try {
    const { data: f } = await v.service
      .from('invoices')
      .select('id, invoice_number, issued_at, pdf_path')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (f) {
      const { data: k } = await v.service
        .from('drive_kopieen')
        .select('gekopieerd_op')
        .eq('root_id', v.rootId)
        .eq('bron', 'factuur')
        .eq('bron_id', f.id)
        .maybeSingle();
      stappen.push({
        naam: 'Laatste factuur',
        uitkomst: 'info',
        tekst: k
          ? `${f.invoice_number} staat in ${boekhoudPad('factuur', jaarVan(f.issued_at)).join('/')}.`
          : `${f.invoice_number} staat nog niet in Drive (gemaakt vóór het koppelen, of de kopie is mislukt: zie de Vercel-logs op "[drive]"). "Bestaande … kopiëren" zet hem er alsnog in.`
      });
    }
  } catch {
    /* alleen ter informatie */
  }

  return klaar();
}
