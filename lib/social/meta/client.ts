import 'server-only';
import { metaAppId, metaAppSecret, versie } from './config';
import { bouwVerzoek, fbReelUploadKoppen, MetaFout, netwerkFout, RUPLOAD_HOST, vertaalMetaFout, type Params } from './kern';

// De Graph API-client (server). Elke aanroep: het token in de Authorization-kop (nooit in de
// URL), appsecret_proof erbij, een time-out, en een Meta-fout wordt een MetaFout met een
// Nederlandse melding (kern.ts). Tokens en URL's met tokens komen nooit in een fout of log.

const TIME_OUT_MS = 20_000;

export async function graph<T>(
  token: string | null,
  pad: string,
  opties: { methode?: 'GET' | 'POST' | 'DELETE'; params?: Params; timeoutMs?: number } = {}
): Promise<T> {
  const v = bouwVerzoek({ versie: versie(), pad, methode: opties.methode, params: opties.params, token, appSecret: token ? metaAppSecret() : null });
  let res: Response;
  try {
    res = await fetch(v.url, { ...v.init, cache: 'no-store', signal: AbortSignal.timeout(opties.timeoutMs ?? TIME_OUT_MS) });
  } catch (e) {
    throw netwerkFout(e);
  }
  const data = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok || (data && typeof data === 'object' && 'error' in data)) throw vertaalMetaFout(res.status, data);
  return data as T;
}

/** App access token ("<app-id>|<app-secret>") voor debug_token; alleen op de server. */
export function appToken(): string {
  return `${metaAppId()}|${metaAppSecret()}`;
}

/** Meta haalt een video zelf op voor een Facebook-reel (rupload, "hosted file"). */
export async function fbReelUpload(pageToken: string, videoId: string, bestandUrl: string): Promise<void> {
  if (!/^\d{1,40}$/.test(videoId)) throw new MetaFout({ soort: 'ongeldig', melding: 'Ongeldig video-id van Meta.', blijvend: true });
  let res: Response;
  try {
    res = await fetch(`${RUPLOAD_HOST}/video-upload/${versie()}/${videoId}`, {
      method: 'POST',
      headers: fbReelUploadKoppen(pageToken, bestandUrl),
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000)
    });
  } catch (e) {
    throw netwerkFout(e);
  }
  const data = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (!res.ok || data.success !== true) throw vertaalMetaFout(res.status || 500, data);
}

export const wacht = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
