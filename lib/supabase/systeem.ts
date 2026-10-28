import 'server-only';
import { createServiceRoleClient } from './service-role';
import { systeemBewijs, type SysteemDoel } from '@/lib/auth/team';

// Service-role zonder ingelogd teamlid, voor een vaste lijst systeemtaken:
//   'audit'          regels toevoegen aan audit_log (ook bij mislukt inloggen of vóór de 2FA-code)
//   'inlogpogingen'  de pogingenlimiet (inloggen, 2FA-codes, wachtwoord-vergeten)
//   'cron'           de dagelijkse taken (heartbeat, back-up), alleen na controle van CRON_SECRET
//   'wachtwoord'     na een geforceerde wachtwoordwissel de vlag wachtwoord_wijzigen weghalen
//                    (die sessie is bewust nog geen teamlid met bewijs)
//   'agendafeed'     de agenda-link (ICS) ophalen voor Apple/Google Agenda, alleen na
//                    controle van het geheime token (lib/agenda/feed.ts)
// Alleen een vaste lijst bestanden mag dit importeren (scripts/test-beveiliging.mjs controleert
// dat); gebruik voor alles wat een gebruiker doet createServiceRoleClient(lid.bewijs).
export function systeemClient(doel: SysteemDoel) {
  return createServiceRoleClient(systeemBewijs(doel));
}
