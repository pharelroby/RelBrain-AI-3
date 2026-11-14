-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0006 · PASSAGE EN PRODUCTION
-- · Classement optimisé : un seul appel, plusieurs portées (général, pays,
--   établissement) et périodes (semaine, tout temps), avec TA position
--   même si tu n'es pas dans le top.
-- · Enregistrement d'un document sans les fonctions /api (hébergement
--   statique) : le fichier est déjà dans le bucket, on crée la ligne
--   « documents » en attente d'analyse IA.
-- ═══════════════════════════════════════════════════════════════════════════

-- Index pour trier vite par XP (classement général, pays, établissement)
create index if not exists profiles_xp_idx          on public.profiles (xp desc, created_at);
create index if not exists profiles_week_xp_idx     on public.profiles (weekly_xp desc, created_at);
create index if not exists profiles_country_xp_idx  on public.profiles (country, xp desc);
create index if not exists profiles_inst_xp_idx     on public.profiles (lower(institution), xp desc);

-- ═══ CLASSEMENT ════════════════════════════════════════════════════════════
-- p_scope  : 'global' | 'country' (même pays que moi) | 'institution' (même établissement)
-- p_period : 'all' (XP totale) | 'week' (XP de la semaine en cours)
-- Retour   : { scope, period, label, total, top:[…], me:{rank, score, …} }
-- Les noms sont abrégés (prénom + initiale) : aucune donnée privée exposée.
create or replace function public.get_leaderboard(p_scope text default 'global', p_period text default 'all', p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  me record;
  v_scope text := case when p_scope in ('global','country','institution') then p_scope else 'global' end;
  v_week boolean := p_period = 'week';
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_total integer; v_rank integer; v_score integer; v_top jsonb; v_label text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into me from public.profiles where id = v_user;

  -- Portée impossible (pays / établissement non renseigné) → on le signale
  if (v_scope = 'country' and coalesce(me.country, '') = '') or (v_scope = 'institution' and coalesce(me.institution, '') = '') then
    return jsonb_build_object('scope', v_scope, 'period', case when v_week then 'week' else 'all' end,
      'missing', case when v_scope = 'country' then 'country' else 'institution' end, 'total', 0, 'top', '[]'::jsonb, 'me', null);
  end if;
  v_label := case v_scope when 'country' then me.country when 'institution' then me.institution else 'RelBrain' end;

  with pool as (
    select p.*, case when v_week then p.weekly_xp else p.xp end as score
      from public.profiles p
     where (v_scope = 'global')
        or (v_scope = 'country' and p.country = me.country)
        or (v_scope = 'institution' and lower(p.institution) = lower(me.institution))
  ), ranked as (
    select pool.*, row_number() over (order by score desc, created_at) as rank from pool
  )
  select
    (select count(*) from pool),
    (select rank from ranked where id = v_user),
    (select score from ranked where id = v_user),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'rank', r.rank,
        'name', coalesce(nullif(r.display_name, ''), coalesce(r.first_name, 'Étudiant') || coalesce(' ' || left(r.last_name, 1) || '.', '')),
        'initial', upper(left(coalesce(nullif(r.first_name, ''), nullif(r.display_name, ''), 'E'), 1)),
        'avatar_url', r.avatar_url, 'level', r.level, 'score', r.score, 'xp', r.xp,
        'league_tier', r.league_tier, 'streak', r.streak_current,
        'country', r.country, 'institution', r.institution, 'me', r.id = v_user
      ) order by r.rank), '[]'::jsonb)
       from ranked r where r.rank <= v_limit)
  into v_total, v_rank, v_score, v_top;

  return jsonb_build_object(
    'scope', v_scope, 'period', case when v_week then 'week' else 'all' end, 'label', v_label,
    'total', v_total, 'top', v_top,
    'me', jsonb_build_object('rank', v_rank, 'score', v_score, 'xp', me.xp, 'level', me.level,
      'percentile', case when v_total > 0 then round(100.0 * (v_total - v_rank + 1) / v_total) else null end,
      -- XP manquants pour dépasser la personne juste devant
      'gap_to_next', (select min(s) - v_score + 1 from (
          select case when v_week then p.weekly_xp else p.xp end as s from public.profiles p
           where ((v_scope = 'global') or (v_scope = 'country' and p.country = me.country)
                  or (v_scope = 'institution' and lower(p.institution) = lower(me.institution)))
             and case when v_week then p.weekly_xp else p.xp end > v_score) x))
  );
end $$;

revoke execute on function public.get_leaderboard(text, text, integer) from public, anon;
grant  execute on function public.get_leaderboard(text, text, integer) to authenticated;


-- ═══ DOCUMENT SANS /api ════════════════════════════════════════════════════
-- Le client a déjà déposé le fichier dans documents/{uid}/… (RLS du bucket).
-- Cette fonction crée la ligne « documents » (insert direct interdit au
-- client) en statut « pending » : visible tout de suite dans Mes documents,
-- le tableau de bord et le profil ; l'analyse IA se fera via /api.
create or replace function public.register_document(
  p_title text, p_path text default null, p_file_name text default null, p_mime text default null,
  p_size bigint default null, p_subject text default null, p_text text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_id uuid; v_xp jsonb; v_source text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> v_user::text then
    raise exception 'forbidden_path' using errcode = '42501';
  end if;
  if p_path is null and coalesce(length(trim(p_text)), 0) < 100 then
    raise exception 'empty_document' using errcode = '22023';
  end if;
  if not public.rate_limit_hit('register_document:' || v_user, 30, 3600) then  -- true = autorisé
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  v_source := case when p_path is null then 'note' else 'upload' end;

  insert into public.documents (user_id, title, subject, source, file_path, file_name, mime_type, size_bytes,
                                word_count, status, status_message, progress)
  values (v_user, left(coalesce(nullif(trim(p_title), ''), nullif(p_file_name, ''), 'Document'), 200),
          left(nullif(trim(p_subject), ''), 60), v_source, p_path, p_file_name, p_mime, p_size,
          case when p_text is not null then array_length(regexp_split_to_array(trim(p_text), '\s+'), 1) end,
          'pending', 'Enregistré · analyse IA en attente', 0)
  returning id into v_id;

  -- Une note garde son texte (réutilisé par l'analyse IA)
  if p_text is not null then
    insert into public.document_chunks (document_id, user_id, chunk_index, content)
    values (v_id, v_user, 0, left(p_text, 20000));
  end if;

  v_xp := public.add_xp(v_user, 15, 'document', v_id::text, 1, true);
  return jsonb_build_object('document_id', v_id, 'status', 'pending', 'xp', v_xp, 'fallback', true);
end $$;

revoke execute on function public.register_document(text, text, text, text, bigint, text, text) from public, anon;
grant  execute on function public.register_document(text, text, text, text, bigint, text, text) to authenticated;
