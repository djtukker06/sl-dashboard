-- 0022: het team van twee (Daniel en Bram) — welkomstflow, wie-ziet-welke-taak, klanten
-- en projecten. Idempotent: twee keer uitvoeren geeft geen fout. Alleen toevoegen; de
-- facturen-functionaliteit (tabellen, RPC's) blijft ongewijzigd. Vereist 0021.
--
-- Dit bestand groeit per bouwstap:
--   stap 1  profiles.welkom_klaar_op (welkomstflow bij de eerste login)

-- ---------------------------------------------------------------------------------
-- Stap 1. Welkomstflow
-- ---------------------------------------------------------------------------------
-- null = de welkomstflow (/welkom) is nog niet doorlopen. De app stuurt een teamlid
-- zolang naar /welkom; zonder deze kolom (0022 nog niet uitgevoerd) slaat de app de
-- flow over.
alter table public.profiles add column if not exists welkom_klaar_op timestamptz;

-- Bestaande eigenaren (Daniel) hebben alles al ingericht: zij zien de flow nooit.
-- Een lid (Bram) wel, ook als hij al vóór deze migratie is uitgenodigd.
update public.profiles p
   set welkom_klaar_op = now()
  from public.team_members m
 where m.user_id = p.id
   and m.rol = 'eigenaar'
   and p.welkom_klaar_op is null;

-- Je mag alleen deze kolom van je EIGEN profiel zetten (de bestaande policy "eigen profiel
-- aanpassen" uit 0021 beperkt tot id = auth.uid() en een actief teamlid). Andere kolommen
-- (e-mail, id) blijven dicht; naam/initialen/kleur waren al toegestaan.
grant update (welkom_klaar_op) on public.profiles to authenticated;
