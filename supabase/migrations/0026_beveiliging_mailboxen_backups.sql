-- 0026: beveiliging, meerdere mailboxen en back-ups.
--
-- Idempotent: twee keer uitvoeren geeft geen fout en verandert niets meer. De app werkt ook
-- zonder deze migratie (dan zoals vóór 0026: één eigen inbox via user_mailboxes).
--
-- Deel 1  mailboxen   meerdere inboxen per teamlid, ook gedeeld met het hele team
--   (volgende delen: audit-log en 2FA, back-ups en heartbeat)

-- ---------------------------------------------------------------------------------
-- Deel 1. Meerdere mailboxen
--
-- Eén rij per gekoppelde inbox. Vervangt functioneel user_mailboxes (die tabel blijft
-- bestaan als terugval voor de code vóór 0026; bestaande koppelingen worden hieronder
-- overgezet).
--   - wachtwoord_enc: AES-256-GCM met MAIL_ENCRYPTION_KEY (alleen in de server-env), met
--     eigenaar_id als AAD. Zo blijven de overgezette ciphertexts uit user_mailboxes geldig.
--   - zichtbaarheid 'prive': alleen de eigenaar; 'team': alle ACTIEVE teamleden, zolang de
--     eigenaar zelf actief is. Dat filter staat in de servercode (lib/mail/zichtbaarheid.ts).
--   - RLS aan en GEEN policies: anon en authenticated lezen of schrijven niets. Alleen de
--     server (service-role, na de teamcheck) gebruikt deze tabel; wachtwoorden en servers
--     gaan nooit naar de browser.
-- ---------------------------------------------------------------------------------
create table if not exists public.mailboxen (
  id uuid primary key default gen_random_uuid(),
  eigenaar_id uuid not null references auth.users (id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  label text not null check (char_length(label) between 1 and 40),
  kleur text not null default '#c8a97e' check (kleur ~ '^#[0-9a-f]{6}$'),
  zichtbaarheid text not null default 'prive' check (zichtbaarheid in ('prive', 'team')),
  volgorde smallint not null default 0,
  imap_host text not null default 'mail.privateemail.com' check (length(imap_host) <= 253),
  imap_port int not null default 993 check (imap_port in (993, 143)),
  smtp_host text not null default 'mail.privateemail.com' check (length(smtp_host) <= 253),
  smtp_port int not null default 465 check (smtp_port in (465, 587)),
  from_name text not null default '' check (length(from_name) <= 120),
  handtekening text not null default '' check (length(handtekening) <= 5000),
  wachtwoord_enc text not null check (wachtwoord_enc like 'v1:%'),
  sleutel_versie smallint not null default 1,
  geverifieerd_op timestamptz,
  gekoppeld_op timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eén keer hetzelfde adres per eigenaar (hoofdletters tellen niet).
create unique index if not exists mailboxen_eigenaar_email on public.mailboxen (eigenaar_id, lower(email));
create index if not exists mailboxen_team on public.mailboxen (eigenaar_id) where zichtbaarheid = 'team';

drop trigger if exists mailboxen_set_updated_at on public.mailboxen;
create trigger mailboxen_set_updated_at
  before update on public.mailboxen
  for each row execute function public.set_updated_at();

alter table public.mailboxen enable row level security;
revoke all on public.mailboxen from anon, authenticated;
grant select, insert, update, delete on public.mailboxen to service_role;

-- Bestaande koppelingen overzetten (één keer; daarna doet "on conflict" niets meer).
-- Label = het deel vóór de @ (bv. "Daniel"), kleur = de profielkleur, alleen voor jezelf.
insert into public.mailboxen (
  eigenaar_id, email, label, kleur, zichtbaarheid, volgorde,
  imap_host, imap_port, smtp_host, smtp_port, from_name, handtekening,
  wachtwoord_enc, sleutel_versie, geverifieerd_op, gekoppeld_op
)
select
  m.user_id,
  lower(m.email),
  left(coalesce(nullif(initcap(split_part(m.email, '@', 1)), ''), 'Inbox'), 40),
  coalesce(
    (select lower(p.kleur) from public.profiles p where p.id = m.user_id and lower(p.kleur) ~ '^#[0-9a-f]{6}$'),
    '#c8a97e'
  ),
  'prive',
  0,
  m.imap_host, m.imap_port, m.smtp_host, m.smtp_port, m.from_name, m.handtekening,
  m.wachtwoord_enc, m.sleutel_versie, m.geverifieerd_op, coalesce(m.updated_at, now())
from public.user_mailboxes m
on conflict (eigenaar_id, lower(email)) do nothing;
