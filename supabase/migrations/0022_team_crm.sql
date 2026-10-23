-- 0022: het team van twee (Daniel en Bram) — welkomstflow, wie-ziet-welke-taak, klanten
-- en projecten. Idempotent: twee keer uitvoeren geeft geen fout. Alleen toevoegen; de
-- facturen-functionaliteit (tabellen, RPC's) blijft ongewijzigd. Vereist 0021.
--
-- Dit bestand groeit per bouwstap:
--   stap 1  profiles.welkom_klaar_op (welkomstflow bij de eerste login)
--   stap 2  wie ziet welke taak/afspraak (leesregels), index voor "Uitgezet"

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

-- ---------------------------------------------------------------------------------
-- Stap 2. Wie ziet welke taak en afspraak
-- ---------------------------------------------------------------------------------
-- Tot nu toe mocht elk teamlid ALLE taken en afspraken lezen (agenda-filter "Heel team").
-- Nu geldt: een taak die Daniel alleen voor Bram maakt, staat bij Bram — en bestaat voor
-- een derde niet, ook niet via de API. Lezen mag:
--   - de maker (die ziet hem onder "Uitgezet", niet in zijn eigen lijst);
--   - wie de taak heeft gekregen (task_assignees);
--   - bij een taak in een project: het hele team (voortgang op de projectpagina). Zo'n
--     taak staat nooit in iemands eigen lijst; die lijsten filteren op task_assignees.
-- Afspraken: de maker en de deelnemers (event_attendees).
-- Wijzigen blijft zoals in 0021 (taak_betrokken / afspraak_betrokken).

-- SECURITY DEFINER: leest tasks/task_assignees zonder RLS, zodat de policies op
-- task_assignees/task_subtasks niet via tasks in een lus terechtkomen.
create or replace function public.taak_zichtbaar(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (t.created_by = (select auth.uid())
           or t.project_id is not null
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.user_id = (select auth.uid())))
  );
$$;

revoke all on function public.taak_zichtbaar(uuid) from public, anon;
grant execute on function public.taak_zichtbaar(uuid) to authenticated, service_role;

drop policy if exists "teamleden lezen taken" on public.tasks;
drop policy if exists "betrokkenen lezen taken" on public.tasks;
create policy "betrokkenen lezen taken" on public.tasks
  for select to authenticated
  using (
    (select public.is_teamlid())
    and (created_by = (select auth.uid())
         or project_id is not null
         or exists (select 1 from public.task_assignees a
                    where a.task_id = tasks.id and a.user_id = (select auth.uid())))
  );

drop policy if exists "teamleden lezen toewijzingen" on public.task_assignees;
drop policy if exists "betrokkenen lezen toewijzingen" on public.task_assignees;
create policy "betrokkenen lezen toewijzingen" on public.task_assignees
  for select to authenticated
  using ((select public.is_teamlid()) and (user_id = (select auth.uid()) or public.taak_zichtbaar(task_id)));

drop policy if exists "teamleden lezen subtaken" on public.task_subtasks;
drop policy if exists "betrokkenen lezen subtaken" on public.task_subtasks;
create policy "betrokkenen lezen subtaken" on public.task_subtasks
  for select to authenticated
  using ((select public.is_teamlid()) and public.taak_zichtbaar(task_id));

drop policy if exists "teamleden lezen afspraken" on public.calendar_events;
drop policy if exists "betrokkenen lezen afspraken" on public.calendar_events;
create policy "betrokkenen lezen afspraken" on public.calendar_events
  for select to authenticated
  using (
    (select public.is_teamlid())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.event_attendees a
                    where a.event_id = calendar_events.id and a.user_id = (select auth.uid())))
  );

drop policy if exists "teamleden lezen deelnemers" on public.event_attendees;
drop policy if exists "betrokkenen lezen deelnemers" on public.event_attendees;
create policy "betrokkenen lezen deelnemers" on public.event_attendees
  for select to authenticated
  using ((select public.is_teamlid()) and (user_id = (select auth.uid()) or public.afspraak_betrokken(event_id)));

-- "Uitgezet": open taken die jij maakte (en waar je zelf niet op staat).
create index if not exists tasks_maker_open_idx on public.tasks (created_by) where completed_at is null;
