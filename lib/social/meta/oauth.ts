import 'server-only';
import { metaAppId, metaAppSecret } from './config';
import { appToken, graph } from './client';

// De Meta-login (Facebook Login for Business, server-kant): code → kortlevend user token →
// langlevend user token (≈60 dagen) → per pagina een page token (verloopt niet zolang de
// toegang niet wordt ingetrokken). Alleen de page tokens worden (versleuteld) bewaard; het
// user token blijft in het geheugen van deze ene aanroep.

interface TokenAntwoord {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** De code uit de callback inwisselen (exact dezelfde redirect-URI als bij de login). */
export async function wisselCode(code: string, redirectUri: string): Promise<TokenAntwoord> {
  return graph<TokenAntwoord>(null, '/oauth/access_token', {
    params: { client_id: metaAppId(), client_secret: metaAppSecret(), redirect_uri: redirectUri, code }
  });
}

/** Kortlevend → langlevend user token. */
export async function langlevend(kort: string): Promise<TokenAntwoord> {
  return graph<TokenAntwoord>(null, '/oauth/access_token', {
    params: { grant_type: 'fb_exchange_token', client_id: metaAppId(), client_secret: metaAppSecret(), fb_exchange_token: kort }
  });
}

export interface MetaPagina {
  id: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

/** Alle pagina's waar deze gebruiker een rol op heeft, met het gekoppelde Instagram-account. */
export async function haalPaginas(userToken: string): Promise<MetaPagina[]> {
  const uit: MetaPagina[] = [];
  let na: string | undefined;
  for (let i = 0; i < 5; i++) {
    const d = await graph<{ data?: MetaPagina[]; paging?: { cursors?: { after?: string }; next?: string } }>(userToken, '/me/accounts', {
      params: {
        fields: 'id,name,access_token,tasks,picture{url},instagram_business_account{id,username,name,profile_picture_url}',
        limit: 100,
        after: na
      }
    });
    uit.push(...(d.data ?? []).filter((p) => typeof p.id === 'string' && /^\d{1,40}$/.test(p.id)));
    na = d.paging?.next ? d.paging?.cursors?.after : undefined;
    if (!na) break;
  }
  return uit;
}

/** De toegekende permissies (namen). */
export async function toegekendeScopes(userToken: string): Promise<string[]> {
  const d = await graph<{ data?: { permission?: string; status?: string }[] }>(userToken, '/me/permissions');
  return (d.data ?? []).filter((p) => p.status === 'granted' && typeof p.permission === 'string').map((p) => p.permission as string);
}

export interface TokenInfo {
  is_valid?: boolean;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
}

/** Gegevens over een token (geldig, verloopt), met het app-token. */
export async function debugToken(token: string): Promise<TokenInfo> {
  const d = await graph<{ data?: TokenInfo }>(null, '/debug_token', { params: { input_token: token, access_token: appToken() } });
  return d.data ?? {};
}
