-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0009 · ADMINISTRATION & MAINTENANCE
-- Rôle administrateur, statistiques globales (RPC réservées), gestion des
-- concours/annales depuis le navigateur, interrupteur de maintenance.
--
-- Nommer un administrateur (éditeur SQL Supabase) :
--   update public.profiles set is_admin = true
--    where id = (select id from auth.users where email = 'adresse@exemple.com');
-- ═══════════════════════════════════════════════════════════════════════════

-- is_admin n'est pas dans la liste GRANT UPDATE de 0001 : un élève ne peut pas se l'attribuer.
alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;
revoke execute on function public.assert_admin() from public, anon, authenticated;


-- ═══ MAINTENANCE ═══════════════════════════════════════════════════════════
create table if not exists public.app_settings (
  id           integer primary key default 1 check (id = 1),
  maintenance  boolean not null default false,
  message      text check (char_length(message) <= 500),
  eta          timestamptz,
  updated_at   timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.tg_set_updated_at();
alter table public.app_settings enable row level security;
create policy "réglages lisibles" on public.app_settings for select to anon, authenticated using (true);
create policy "réglages admin"    on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke insert, delete, update on public.app_settings from anon, authenticated;
grant  select on public.app_settings to anon, authenticated;
grant  update (maintenance, message, eta) on public.app_settings to authenticated;


-- ═══ CONCOURS & ANNALES : écriture réservée aux administrateurs ═══════════
grant insert, update, delete on public.concours, public.concours_levels, public.concours_annales to authenticated;
create policy "admin concours" on public.concours         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin niveaux"  on public.concours_levels  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin annales"  on public.concours_annales for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "annales: dépôt admin"        on storage.objects for insert to authenticated with check (bucket_id = 'annales' and public.is_admin());
create policy "annales: remplacement admin" on storage.objects for update to authenticated using (bucket_id = 'annales' and public.is_admin());
create policy "annales: suppression admin"  on storage.objects for delete to authenticated using (bucket_id = 'annales' and public.is_admin());


-- ═══ MESSAGES DE CONTACT ═══════════════════════════════════════════════════
create policy "admin messages" on public.contact_messages for select to authenticated using (public.is_admin());
create policy "admin messages statut" on public.contact_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.contact_messages to authenticated;
grant update (status) on public.contact_messages to authenticated;


-- ═══ VUE D'ENSEMBLE ════════════════════════════════════════════════════════
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'users', jsonb_build_object(
      'total',       (select count(*) from auth.users),
      'new_7d',      (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'confirmed',   (select count(*) from auth.users where email_confirmed_at is not null),
      'active_today',(select count(distinct user_id) from public.xp_events where created_at > now() - interval '24 hours'),
      'active_7d',   (select count(distinct user_id) from public.xp_events where created_at > now() - interval '7 days')),
    'content', jsonb_build_object(
      'documents',   (select count(*) from public.documents),
      'doc_pending', (select count(*) from public.documents where status in ('pending','processing')),
      'doc_failed',  (select count(*) from public.documents where status = 'failed'),
      'quizzes',     (select count(*) from public.quizzes),
      'attempts',    (select count(*) from public.quiz_attempts where completed_at is not null),
      'reviews',     (select count(*) from public.flashcard_reviews),
      'annales',     (select count(*) from public.concours_annales)),
    'plans', (select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb) from (select plan, count(*) n from public.subscriptions where status in ('active','trialing') group by 1) x),
    'revenue_30d', (select coalesce(jsonb_object_agg(currency, n), '{}'::jsonb) from (select currency, sum(amount) n from public.payments where status = 'succeeded' and created_at > now() - interval '30 days' group by 1) x),
    'ai', jsonb_build_object(
      'requests_24h', (select count(*) from public.ai_usage where created_at > now() - interval '24 hours'),
      'tokens_30d',   (select coalesce(sum(total_tokens), 0) from public.ai_usage where created_at > now() - interval '30 days'),
      'cost_30d',     (select coalesce(sum(cost_usd), 0) from public.ai_usage where created_at > now() - interval '30 days'),
      'by_route',     (select coalesce(jsonb_agg(x order by x.tokens desc), '[]'::jsonb) from (select route, model, count(*) calls, sum(total_tokens) tokens from public.ai_usage where created_at > now() - interval '30 days' group by 1, 2) x)),
    'messages_new', (select count(*) from public.contact_messages where status = 'new'),
    'signups', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'n', coalesce(s.n, 0), 'active', coalesce(a.n, 0)) order by d.day), '[]'::jsonb)
                  from (select gs::date as day from generate_series(current_date - 29, current_date, interval '1 day') gs) d
                  left join (select created_at::date as day, count(*) n from auth.users group by 1) s on s.day = d.day
                  left join (select created_at::date as day, count(distinct user_id) n from public.xp_events group by 1) a on a.day = d.day)
  );
end $$;

create or replace function public.admin_users(p_search text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare q text := '%' || coalesce(trim(p_search), '') || '%';
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'total', (select count(*) from auth.users u left join public.profiles p on p.id = u.id
               where u.email ilike q or coalesce(p.first_name || ' ' || p.last_name, p.first_name, '') ilike q or coalesce(p.institution, '') ilike q),
    'rows', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null as confirmed,
             p.first_name, p.last_name, p.country, p.institution, p.school_level, p.xp, p.level, p.streak_current as streak,
             p.league_tier, p.is_admin, s.plan, s.status as sub_status,
             (select count(*) from public.documents d where d.user_id = u.id) as documents,
             (select count(*) from public.quiz_attempts a where a.user_id = u.id and a.completed_at is not null) as quizzes
        from auth.users u
        left join public.profiles p on p.id = u.id
        left join public.subscriptions s on s.user_id = u.id
       where u.email ilike q or coalesce(p.first_name || ' ' || p.last_name, p.first_name, '') ilike q or coalesce(p.institution, '') ilike q
       order by u.created_at desc
       limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x)
  );
end $$;

create or replace function public.admin_set_user(p_user uuid, p_plan text default null, p_is_admin boolean default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_is_admin is false and p_user = auth.uid() then raise exception 'cannot_demote_self' using errcode = '22023'; end if;
  if p_is_admin is not null then update public.profiles set is_admin = p_is_admin where id = p_user; end if;
  if p_plan is not null then
    insert into public.subscriptions (user_id, plan, status, provider) values (p_user, p_plan::public.plan_tier, 'active', 'manual')
    on conflict (user_id) do update set plan = excluded.plan, status = 'active', provider = 'manual';
  end if;
end $$;

create or replace function public.admin_documents(p_status text default null, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.assert_admin();
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select d.id, d.title, d.subject, d.source, d.status, d.status_message, d.size_bytes, d.page_count, d.created_at, u.email
      from public.documents d join auth.users u on u.id = d.user_id
     where p_status is null or d.status::text = p_status
     order by d.created_at desc limit least(greatest(p_limit, 1), 300)) x);
end $$;

create or replace function public.admin_payments(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.assert_admin();
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select p.id, p.provider, p.plan, p.period_months, p.amount, p.currency, p.status, p.created_at, u.email
      from public.payments p join auth.users u on u.id = p.user_id
     order by p.created_at desc limit least(greatest(p_limit, 1), 300)) x);
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_overview()', 'admin_users(text,integer,integer)', 'admin_set_user(uuid,text,boolean)',
                           'admin_documents(text,integer)', 'admin_payments(integer)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
