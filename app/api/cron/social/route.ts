import { cronRoute } from '@/lib/auth/cron';
import { verwerkSocialCron } from '@/lib/social/plaatsen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Social: ingeplande posts op tijd plaatsen (Instagram en Facebook). Elke 5 minuten
// aangeroepen door Supabase pg_cron + pg_net (supabase/UITVOEREN_0041_cron.sql; Vercel Hobby
// kan maar 1× per dag). Alleen met "Authorization: Bearer <CRON_SECRET>" (lib/auth/cron.ts).
// Zonder Meta-instellingen of vóór migratie 0041 doet hij niets (status in het antwoord).
export const GET = cronRoute('social', async (_request, { service }) => verwerkSocialCron(service, new Date()));
