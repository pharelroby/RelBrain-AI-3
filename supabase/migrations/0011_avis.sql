-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 — Avis des élèves (vrais avis uniquement)
-- · Seul un élève inscrit peut laisser un avis, un seul par compte (modifiable).
-- · Tout avis est « en attente » tant que l'administrateur ne l'a pas validé.
-- · La page d'accueil ne lit que les avis validés, par public_reviews().
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  rating        smallint not null check (rating between 1 and 5),
  comment       text not null check (char_length(comment) between 10 and 500),
  display_name  text not null check (char_length(display_name) between 2 and 60),
  allow_publish boolean not null default true,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.reviews enable row level security;

drop policy if exists reviews_own_read on public.reviews;
create policy reviews_own_read on public.reviews for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists reviews_own_insert on public.reviews;
create policy reviews_own_insert on public.reviews for insert with check (auth.uid() = user_id);
drop policy if exists reviews_own_update on public.reviews;
create policy reviews_own_update on public.reviews for update using (auth.uid() = user_id or public.is_admin()) with check (auth.uid() = user_id or public.is_admin());
drop policy if exists reviews_admin_delete on public.reviews;
create policy reviews_admin_delete on public.reviews for delete using (public.is_admin());

-- Un élève ne peut jamais valider son propre avis : chaque modification le remet en attente.
create or replace function public.reviews_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  -- Les élèves (rôles anon / authenticated non administrateurs) ne valident jamais eux-mêmes.
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    new.status := 'pending';
    if tg_op = 'UPDATE' then new.user_id := old.user_id; new.created_at := old.created_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists reviews_guard on public.reviews;
create trigger reviews_guard before insert or update on public.reviews
  for each row execute function public.reviews_guard();

-- Avis publics (page d'accueil) : uniquement validés et dont l'auteur accepte la publication.
create or replace function public.public_reviews(p_limit integer default 12) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', (select count(*) from public.reviews where status = 'approved' and allow_publish),
    'average', (select round(avg(rating)::numeric, 1) from public.reviews where status = 'approved' and allow_publish),
    'items', coalesce((select jsonb_agg(x) from (
        select rating, comment, display_name, created_at from public.reviews
         where status = 'approved' and allow_publish
         order by created_at desc limit least(greatest(p_limit, 1), 30)) x), '[]'::jsonb)
  );
$$;
grant execute on function public.public_reviews(integer) to anon, authenticated;

-- Faut-il proposer à l'élève de donner son avis ? Oui s'il n'en a pas encore laissé
-- et qu'il a vraiment utilisé RelBrain : 2 quiz terminés, ou 15 cartes révisées,
-- ou 1 quiz et 1 document analysé, sur un compte d'au moins 2 jours.
create or replace function public.should_ask_review() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is not null
     and not exists (select 1 from public.reviews where user_id = auth.uid())
     and exists (select 1 from auth.users where id = auth.uid() and created_at < now() - interval '2 days')
     and (
       (select count(*) from public.quiz_attempts where user_id = auth.uid() and completed_at is not null) >= 2
       or (select count(*) from public.flashcard_reviews where user_id = auth.uid()) >= 15
       or ((select count(*) from public.quiz_attempts where user_id = auth.uid() and completed_at is not null) >= 1
           and exists (select 1 from public.documents where user_id = auth.uid() and status = 'ready'))
     );
$$;
revoke execute on function public.should_ask_review() from public, anon;
grant execute on function public.should_ask_review() to authenticated;
