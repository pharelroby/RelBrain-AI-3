-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0002 · GAMIFICATION
-- XP & niveaux · séries · badges · ligues hebdomadaires · défis · récompenses
-- · notifications · rappels intelligents.
--
-- Toutes les fonctions qui modifient l'XP sont SECURITY DEFINER et ne sont
-- PAS exécutables par les clients : elles sont appelées par les RPC métier
-- (finish_quiz_attempt, review_flashcard…) ou par la clé service_role.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Niveaux : chaque niveau demande 1,5× plus d'XP que le précédent ───────
--   Niveau 1→2 : 100 XP · 2→3 : 150 · 3→4 : 225 · …
--   XP cumulée pour atteindre le niveau L : 200 × (1,5^(L-1) − 1)
create or replace function public.xp_for_level(p_level integer) returns integer
language sql immutable as $$
  select round(200 * (power(1.5::numeric, greatest(p_level, 1) - 1) - 1))::integer
$$;

create or replace function public.level_for_xp(p_xp integer) returns integer
language sql immutable as $$
  select greatest(1, floor(ln(greatest(p_xp, 0)::numeric / 200 + 1) / ln(1.5) + 0.000001)::integer + 1)
$$;

-- ─── Horloges ─────────────────────────────────────────────────────────────
create or replace function public.user_today(p_user uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.profiles where id = p_user), 'Africa/Douala'))::date
$$;

-- Les ligues suivent l'heure de Douala : la semaine se termine dimanche 23:59.
create or replace function public.league_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Douala')::date $$;

create or replace function public.week_start(p_day date) returns date
language sql immutable as $$ select p_day - (extract(isodow from p_day)::integer - 1) $$;


-- ═══ NOTIFICATIONS ═════════════════════════════════════════════════════════
-- Crée une notification in-app si la catégorie est activée dans les préférences.
-- L'envoi push / email est fait par /api/cron/notifications (lit push_sent_at).
create or replace function public.notify(
  p_user uuid, p_category public.notif_category, p_title text, p_body text default null,
  p_icon text default null, p_link text default null, p_data jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_on boolean := true; p record;
begin
  select * into p from public.notification_preferences where user_id = p_user;
  if found then
    v_on := case p_category
      when 'reminder' then p.reminders when 'badge' then p.badges when 'goal' then p.goals
      when 'league' then p.league when 'streak' then p.streak when 'ai' then p.ai else true end;
  end if;
  if not v_on then return null; end if;
  insert into public.notifications (user_id, category, title, body, icon, link, data)
  values (p_user, p_category, p_title, p_body, p_icon, p_link, coalesce(p_data, '{}'))
  returning id into v_id;
  return v_id;
end $$;


-- ═══ SÉRIES (STREAKS) ══════════════════════════════════════════════════════
-- Appelée à chaque activité d'apprentissage qualifiante.
create or replace function public.touch_streak(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.user_today(p_user);
  v_last date; v_cur integer; v_best integer; v_freezes integer;
  v_extended boolean := false; v_freeze_used boolean := false;
begin
  select last_study_date, streak_current, streak_best, streak_freezes
    into v_last, v_cur, v_best, v_freezes
    from public.profiles where id = p_user for update;
  if not found then return '{}'::jsonb; end if;

  if v_last = v_today then
    return jsonb_build_object('streak', v_cur, 'extended', false, 'freeze_used', false);
  elsif v_last = v_today - 1 then
    v_cur := v_cur + 1; v_extended := true;
  elsif v_last = v_today - 2 and v_freezes > 0 then
    v_cur := v_cur + 1; v_freezes := v_freezes - 1; v_extended := true; v_freeze_used := true;
  else
    v_cur := 1; v_extended := true;
  end if;

  update public.profiles
     set last_study_date = v_today, streak_current = v_cur,
         streak_best = greatest(v_best, v_cur), streak_freezes = v_freezes
   where id = p_user;

  if v_cur in (3, 7, 14, 30, 50, 100, 200, 365) then
    perform public.notify(p_user, 'streak', v_cur || ' jours de suite 🔥',
      'Ta série grandit. Bonus XP de série : ×' || to_char(least(1.5, 1 + 0.05 * floor(v_cur / 7.0)), 'FM0.00'),
      '🔥', 'relbrain-profil.html');
  end if;
  return jsonb_build_object('streak', v_cur, 'extended', v_extended, 'freeze_used', v_freeze_used);
end $$;

-- Tâche planifiée (horaire) : gèle ou remet à zéro les séries interrompues.
create or replace function public.streak_maintenance() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_today date; n integer := 0;
begin
  for r in
    select id, last_study_date, streak_current, streak_freezes from public.profiles
     where streak_current > 0 and last_study_date is not null
  loop
    v_today := public.user_today(r.id);
    if r.last_study_date >= v_today - 1 then continue; end if;
    if r.last_study_date = v_today - 2 and r.streak_freezes > 0 then
      update public.profiles set streak_freezes = streak_freezes - 1, last_study_date = v_today - 1 where id = r.id;
      perform public.notify(r.id, 'streak', 'Gel de série utilisé ❄️',
        'Ta série de ' || r.streak_current || ' jours est protégée. Reviens aujourd''hui pour la prolonger !', '❄️', 'relbrain-accueil.html');
    else
      update public.profiles set streak_current = 0 where id = r.id;
      perform public.notify(r.id, 'streak', 'Ta série s''est arrêtée',
        'Tu avais tenu ' || r.streak_current || ' jours. Un quiz de 5 minutes suffit pour repartir.', '💤', 'relbrain-quiz-setup.html');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;


-- ═══ STATISTIQUES (base des badges) ════════════════════════════════════════
create or replace function public.user_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select * from public.profiles where id = p_user),
  tz as (select coalesce((select timezone from p), 'Africa/Douala') as z)
  select jsonb_build_object(
    'xp_total',            (select xp from p),
    'level',               (select level from p),
    'streak_best',         (select streak_best from p),
    'quizzes_completed',   (select count(*) from public.quiz_attempts where user_id = p_user and completed_at is not null),
    'perfect_quizzes',     (select count(*) from public.quiz_attempts where user_id = p_user and completed_at is not null and total_count >= 5 and correct_count = total_count),
    'correct_answers',     (select count(*) from public.quiz_answers where user_id = p_user and is_correct),
    'cards_reviewed',      (select count(*) from public.flashcard_reviews where user_id = p_user),
    'cards_created',       (select count(*) from public.flashcards where user_id = p_user),
    'documents_uploaded',  (select count(*) from public.documents where user_id = p_user and status = 'ready'),
    'notes_count',         (select count(*) from public.documents where user_id = p_user and source = 'note'),
    'study_minutes',       (select coalesce(sum(duration_seconds), 0) / 60 from public.study_sessions where user_id = p_user),
    'challenges_completed',(select count(*) from public.user_challenges where user_id = p_user and completed_at is not null),
    'weekly_challenges',   (select count(*) from public.user_challenges where user_id = p_user and completed_at is not null and period = 'weekly'),
    'league_promotions',   (select count(*) from public.league_members where user_id = p_user and outcome = 'promoted'),
    'league_rank',         (select array_position(enum_range(null::public.league_tier), league_tier) from p),
    'weekly_wins',         (select count(*) from public.league_members where user_id = p_user and final_rank = 1),
    'subjects_count',      (select count(*) from public.user_progress where user_id = p_user),
    'mastered_subjects',   (select count(*) from public.user_progress where user_id = p_user and mastery >= 80),
    'chat_messages',       (select count(*) from public.ai_messages where user_id = p_user and role = 'user'),
    'summaries_count',     (select count(*) from public.summaries where user_id = p_user),
    'night_sessions',      (select count(*) from public.study_sessions, tz where user_id = p_user and extract(hour from started_at at time zone tz.z) in (22,23,0,1,2,3)),
    'early_sessions',      (select count(*) from public.study_sessions, tz where user_id = p_user and extract(hour from started_at at time zone tz.z) between 4 and 6),
    'fast_quizzes',        (select count(*) from public.quiz_attempts where user_id = p_user and completed_at is not null and total_count >= 10 and duration_seconds is not null and duration_seconds < total_count * 15 and correct_count >= total_count * 0.8),
    'comeback',            (select count(*) from public.xp_events where user_id = p_user and reason = 'comeback'),
    'email_verified',      (select case when email_verified_bonus then 1 else 0 end from p),
    'profile_complete',    (select case when first_name is not null and school_level is not null and country is not null and avatar_url is not null then 1 else 0 end from p),
    'is_premium',          (select case when plan <> 'free' and status in ('active','trialing') then 1 else 0 end from public.subscriptions where user_id = p_user)
  )
$$;


-- ═══ BADGES ════════════════════════════════════════════════════════════════
create or replace function public.check_achievements(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_stats jsonb; r record; v_new jsonb := '[]'::jsonb; v_rows integer; v_pass integer := 0;
begin
  loop
    v_pass := v_pass + 1;
    v_stats := public.user_stats(p_user);
    v_rows := 0;
    for r in
      select a.* from public.achievements a
       where not exists (select 1 from public.user_achievements ua where ua.user_id = p_user and ua.achievement_id = a.id)
       order by a.sort
    loop
      if coalesce((v_stats ->> r.metric)::numeric, 0) >= r.threshold then
        insert into public.user_achievements (user_id, achievement_id) values (p_user, r.id) on conflict do nothing;
        if found then
          v_rows := v_rows + 1;
          v_new := v_new || jsonb_build_array(jsonb_build_object('id', r.id, 'name', r.name, 'icon', r.icon, 'tier', r.tier, 'xp', r.xp_reward, 'description', r.description));
          perform public.notify(p_user, 'badge', 'Badge débloqué : ' || r.name, r.description, r.icon, 'relbrain-profil.html#badges', jsonb_build_object('achievement_id', r.id));
          if r.xp_reward > 0 then
            perform public.add_xp(p_user, r.xp_reward, 'achievement', r.id, 1, false);
          end if;
          -- Récompenses liées au badge
          insert into public.user_rewards (user_id, reward_id)
            select p_user, ri.id from public.reward_items ri where ri.unlock_achievement = r.id
          on conflict do nothing;
        end if;
      end if;
    end loop;
    exit when v_rows = 0 or v_pass >= 2;   -- 2e passe : badges débloqués par l'XP des badges
  end loop;
  return v_new;
end $$;


-- ═══ RÉCOMPENSES PAR NIVEAU ════════════════════════════════════════════════
create or replace function public.unlock_level_rewards(p_user uuid, p_level integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_new jsonb;
begin
  with ins as (
    insert into public.user_rewards (user_id, reward_id)
    select p_user, ri.id from public.reward_items ri
     where ri.unlock_level is not null and ri.unlock_level <= p_level
    on conflict do nothing
    returning reward_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', ri.id, 'kind', ri.kind, 'name', ri.name)), '[]'::jsonb)
    into v_new from ins join public.reward_items ri on ri.id = ins.reward_id;
  -- Un gel de série offert tous les 5 niveaux (max 5 en réserve)
  if p_level % 5 = 0 then
    update public.profiles set streak_freezes = least(5, streak_freezes + 1) where id = p_user;
  end if;
  return v_new;
end $$;


-- ═══ LIGUES ════════════════════════════════════════════════════════════════
create or replace function public.ensure_league_member(p_user uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_week bigint; v_tier public.league_tier; v_group bigint; v_ws date := public.week_start(public.league_today());
begin
  insert into public.league_weeks (week_start) values (v_ws) on conflict (week_start) do nothing;
  select id into v_week from public.league_weeks where week_start = v_ws;

  select lm.group_id into v_group
    from public.league_members lm join public.league_groups g on g.id = lm.group_id
   where lm.user_id = p_user and g.week_id = v_week;
  if v_group is not null then return v_group; end if;

  select league_tier into v_tier from public.profiles where id = p_user;
  select id into v_group from public.league_groups
   where week_id = v_week and tier = v_tier and member_count < 30
   order by member_count desc limit 1 for update skip locked;
  if v_group is null then
    insert into public.league_groups (week_id, tier) values (v_week, v_tier) returning id into v_group;
  end if;
  insert into public.league_members (group_id, user_id) values (v_group, p_user) on conflict do nothing;
  update public.league_groups set member_count = member_count + 1 where id = v_group;
  return v_group;
end $$;

-- Clôture hebdomadaire (dimanche 23:59, heure de Douala) :
-- top 7 promus, 5 derniers relégués (groupes ≥ 10 membres), XP hebdo remise à zéro.
create or replace function public.finalize_league_weeks() returns integer
language plpgsql security definer set search_path = public as $$
declare
  w record; g record; m record; n integer := 0;
  v_tiers text[] := enum_range(null::public.league_tier)::text[];
  v_idx integer; v_size integer;
begin
  for w in select * from public.league_weeks
            where finalized_at is null and week_start < public.week_start(public.league_today())
  loop
    for g in select * from public.league_groups where week_id = w.id loop
      select count(*) into v_size from public.league_members where group_id = g.id;
      v_idx := array_position(v_tiers, g.tier::text);
      for m in
        select user_id, weekly_xp, row_number() over (order by weekly_xp desc, joined_at) as rn
          from public.league_members where group_id = g.id
      loop
        update public.league_members
           set final_rank = m.rn,
               outcome = case
                 when m.rn <= 7 and m.weekly_xp > 0 and v_idx < array_length(v_tiers, 1) then 'promoted'
                 when v_size >= 10 and m.rn > v_size - 5 and v_idx > 1 then 'demoted'
                 else 'stayed' end
         where group_id = g.id and user_id = m.user_id;

        if m.rn <= 7 and m.weekly_xp > 0 and v_idx < array_length(v_tiers, 1) then
          update public.profiles set league_tier = v_tiers[v_idx + 1]::public.league_tier where id = m.user_id;
          perform public.notify(m.user_id, 'league', 'Promotion en ligue ' || initcap(v_tiers[v_idx + 1]) || ' 🚀',
            'Tu as terminé ' || m.rn || 'e de ta ligue cette semaine.', '🏆', 'relbrain-classement.html');
          perform public.check_achievements(m.user_id);
        elsif v_size >= 10 and m.rn > v_size - 5 and v_idx > 1 then
          update public.profiles set league_tier = v_tiers[v_idx - 1]::public.league_tier where id = m.user_id;
          perform public.notify(m.user_id, 'league', 'Retour en ligue ' || initcap(v_tiers[v_idx - 1]),
            'Pas de panique : quelques sessions cette semaine et tu remontes.', '🛡️', 'relbrain-classement.html');
        end if;
      end loop;
    end loop;
    update public.league_weeks set finalized_at = now() where id = w.id;
    n := n + 1;
  end loop;
  if n > 0 then update public.profiles set weekly_xp = 0 where weekly_xp <> 0; end if;
  return n;
end $$;


-- ═══ DÉFIS QUOTIDIENS & HEBDOMADAIRES ══════════════════════════════════════
-- 3 défis par jour, 1 défi par semaine, tirés de façon déterministe par utilisateur.
create or replace function public.assign_challenges(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_today date := public.user_today(p_user); v_week date := public.week_start(public.user_today(p_user));
begin
  if not exists (select 1 from public.user_challenges where user_id = p_user and period = 'daily' and period_start = v_today) then
    insert into public.user_challenges (user_id, template_id, period, period_start, metric, target, xp_reward)
    select p_user, t.id, 'daily', v_today, t.metric, t.target, t.xp_reward
      from public.challenge_templates t where t.period = 'daily'
     order by md5(p_user::text || v_today::text || t.id)
     limit 3
    on conflict do nothing;
  end if;
  if not exists (select 1 from public.user_challenges where user_id = p_user and period = 'weekly' and period_start = v_week) then
    insert into public.user_challenges (user_id, template_id, period, period_start, metric, target, xp_reward)
    select p_user, t.id, 'weekly', v_week, t.metric, t.target, t.xp_reward
      from public.challenge_templates t where t.period = 'weekly'
     order by md5(p_user::text || v_week::text || t.id)
     limit 1
    on conflict do nothing;
  end if;
end $$;

create or replace function public.bump_challenges(p_user uuid, p_metric text, p_amount integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_done jsonb := '[]'::jsonb;
  v_today date := public.user_today(p_user); v_week date := public.week_start(public.user_today(p_user));
begin
  if p_amount <= 0 then return v_done; end if;
  perform public.assign_challenges(p_user);
  for r in
    update public.user_challenges uc
       set progress = least(uc.target, uc.progress + p_amount),
           completed_at = case when uc.progress + p_amount >= uc.target then now() else null end
     where uc.user_id = p_user and uc.metric = p_metric and uc.completed_at is null
       and ((uc.period = 'daily' and uc.period_start = v_today) or (uc.period = 'weekly' and uc.period_start = v_week))
    returning uc.*
  loop
    if r.completed_at is not null then
      v_done := v_done || jsonb_build_array(jsonb_build_object('id', r.id, 'template_id', r.template_id, 'xp', r.xp_reward));
      perform public.notify(p_user, 'goal', 'Défi réussi ✅',
        (select title from public.challenge_templates where id = r.template_id) || ' · +' || r.xp_reward || ' XP', '🎯', 'relbrain-accueil.html');
      perform public.add_xp(p_user, r.xp_reward, 'challenge', r.id::text, 1, true);
    end if;
  end loop;
  return v_done;
end $$;


-- ═══ XP : POINT D'ENTRÉE UNIQUE ════════════════════════════════════════════
-- Multiplicateurs :
--   · série    : +5 % par semaine de série complète (max ×1,5)
--   · p_bonus  : bonus de vitesse / perfection passés par l'appelant
--   · plafond global ×3
create or replace function public.add_xp(
  p_user uuid, p_base integer, p_reason text, p_source text default null,
  p_bonus numeric default 1, p_check boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_streak integer; v_old_level integer; v_new_level integer; v_xp integer;
  v_mult numeric; v_amount integer; v_group bigint;
  v_achievements jsonb := '[]'::jsonb; v_rewards jsonb := '[]'::jsonb; v_challenges jsonb := '[]'::jsonb;
begin
  if p_base is null or p_base <= 0 then
    return jsonb_build_object('awarded', 0);
  end if;

  select streak_current, level into v_streak, v_old_level from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('awarded', 0); end if;

  v_mult := least(3, least(1.5, 1 + 0.05 * floor(coalesce(v_streak, 0) / 7.0)) * greatest(coalesce(p_bonus, 1), 1));
  -- Les XP de badges et de défis ne sont pas multipliés (évite l'inflation)
  if p_reason in ('achievement', 'challenge', 'bonus') then v_mult := 1; end if;
  v_amount := round(p_base * v_mult);

  update public.profiles
     set xp = xp + v_amount,
         weekly_xp = weekly_xp + v_amount,
         level = public.level_for_xp(xp + v_amount)
   where id = p_user
  returning xp, level into v_xp, v_new_level;

  insert into public.xp_events (user_id, amount, base_amount, multiplier, reason, source_id)
  values (p_user, v_amount, p_base, v_mult, p_reason, p_source);

  v_group := public.ensure_league_member(p_user);
  update public.league_members set weekly_xp = weekly_xp + v_amount where group_id = v_group and user_id = p_user;

  if p_reason not in ('achievement', 'challenge', 'bonus') then
    v_challenges := public.bump_challenges(p_user, 'xp', v_amount);
  end if;

  if v_new_level > v_old_level then
    v_rewards := public.unlock_level_rewards(p_user, v_new_level);
    perform public.notify(p_user, 'badge', 'Niveau ' || v_new_level || ' atteint ✨',
      'Continue comme ça : le niveau ' || (v_new_level + 1) || ' est à ' || (public.xp_for_level(v_new_level + 1) - v_xp) || ' XP.',
      '⭐', 'relbrain-profil.html', jsonb_build_object('level', v_new_level));
  end if;

  if p_check then v_achievements := public.check_achievements(p_user); end if;

  return jsonb_build_object(
    'awarded', v_amount, 'base', p_base, 'multiplier', v_mult,
    'xp', v_xp, 'level', v_new_level, 'previous_level', v_old_level,
    'leveled_up', v_new_level > v_old_level,
    'level_floor_xp', public.xp_for_level(v_new_level),
    'next_level_xp', public.xp_for_level(v_new_level + 1),
    'achievements', v_achievements, 'rewards', v_rewards, 'challenges', v_challenges
  );
end $$;


-- ═══ RPC EXPOSÉES AU CLIENT ════════════════════════════════════════════════
-- Résumé gamification de l'utilisateur connecté (sidebar, dashboard, profil)
create or replace function public.get_my_gamification() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); p record; v_group bigint; v_rank integer; v_size integer;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into p from public.profiles where id = v_user;
  v_group := public.ensure_league_member(v_user);
  select count(*) into v_size from public.league_members where group_id = v_group;
  select rn into v_rank from (
    select user_id, row_number() over (order by weekly_xp desc, joined_at) rn from public.league_members where group_id = v_group
  ) x where user_id = v_user;
  perform public.assign_challenges(v_user);
  return jsonb_build_object(
    'xp', p.xp, 'level', p.level, 'weekly_xp', p.weekly_xp,
    'level_floor_xp', public.xp_for_level(p.level), 'next_level_xp', public.xp_for_level(p.level + 1),
    'streak', p.streak_current, 'streak_best', p.streak_best, 'streak_freezes', p.streak_freezes,
    'studied_today', p.last_study_date = public.user_today(v_user),
    'league', jsonb_build_object('tier', p.league_tier, 'rank', v_rank, 'size', v_size,
      'ends_at', (public.week_start(public.league_today()) + 7)::timestamp at time zone 'Africa/Douala'),
    'badges_count', (select count(*) from public.user_achievements where user_id = v_user),
    'badges_total', (select count(*) from public.achievements),
    'unread_notifications', (select count(*) from public.notifications where user_id = v_user and read_at is null),
    'challenges', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', uc.id, 'period', uc.period, 'title', t.title, 'description', t.description, 'icon', t.icon,
        'progress', uc.progress, 'target', uc.target, 'xp', uc.xp_reward, 'completed', uc.completed_at is not null)
        order by uc.period, t.title), '[]'::jsonb)
      from public.user_challenges uc join public.challenge_templates t on t.id = uc.template_id
      where uc.user_id = v_user and (
        (uc.period = 'daily' and uc.period_start = public.user_today(v_user)) or
        (uc.period = 'weekly' and uc.period_start = public.week_start(public.user_today(v_user))))
    )
  );
end $$;

-- Classement de la ligue de l'utilisateur (noms abrégés : prénom + initiale)
create or replace function public.get_league_leaderboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_group bigint; v_tier public.league_tier; v_size integer;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  v_group := public.ensure_league_member(v_user);
  select tier into v_tier from public.league_groups where id = v_group;
  select count(*) into v_size from public.league_members where group_id = v_group;
  return jsonb_build_object(
    'tier', v_tier, 'size', v_size, 'promote_until', 7,
    'demote_from', case when v_size >= 10 then v_size - 4 else null end,
    'ends_at', (public.week_start(public.league_today()) + 7)::timestamp at time zone 'Africa/Douala',
    'members', (
      select coalesce(jsonb_agg(x order by x.rank), '[]'::jsonb) from (
        select row_number() over (order by lm.weekly_xp desc, lm.joined_at) as rank,
               coalesce(nullif(p.display_name, ''), coalesce(p.first_name, 'Étudiant') || coalesce(' ' || left(p.last_name, 1) || '.', '')) as name,
               p.avatar_url, p.level, lm.weekly_xp as xp, lm.user_id = v_user as me
          from public.league_members lm join public.profiles p on p.id = lm.user_id
         where lm.group_id = v_group
      ) x
    )
  );
end $$;

-- Historique des ligues de l'utilisateur (10 dernières semaines)
create or replace function public.get_my_league_history() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.week_start desc), '[]'::jsonb) from (
    select w.week_start, g.tier, lm.weekly_xp, lm.final_rank, lm.outcome, w.finalized_at is not null as finished
      from public.league_members lm
      join public.league_groups g on g.id = lm.group_id
      join public.league_weeks w on w.id = g.week_id
     where lm.user_id = auth.uid()
     order by w.week_start desc limit 10
  ) x
$$;

-- Classement général (top N par XP totale)
create or replace function public.get_global_leaderboard(p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by p.xp desc) as rank,
           coalesce(nullif(p.display_name, ''), coalesce(p.first_name, 'Étudiant') || coalesce(' ' || left(p.last_name, 1) || '.', '')) as name,
           p.avatar_url, p.level, p.xp, p.league_tier, p.id = auth.uid() as me
      from public.profiles p order by p.xp desc limit least(greatest(p_limit, 1), 100)
  ) x
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;


-- ═══ RAPPELS INTELLIGENTS ══════════════════════════════════════════════════
-- Apprend l'heure d'étude habituelle (mode des 30 derniers jours).
create or replace function public.refresh_study_habits() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with h as (
    select s.user_id, mode() within group (order by extract(hour from s.started_at at time zone p.timezone)::smallint) as hr
      from public.study_sessions s join public.profiles p on p.id = s.user_id
     where s.started_at > now() - interval '30 days'
     group by s.user_id having count(*) >= 3
  )
  update public.profiles p set preferred_study_hour = h.hr from h where p.id = h.user_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Utilisateurs à relancer maintenant : pas encore étudié aujourd'hui, heure locale
-- = heure choisie (ou apprise, ou 18h), hors heures calmes, pas déjà relancés.
create or replace function public.users_due_for_reminder() returns table (
  user_id uuid, email text, first_name text, streak integer, due_cards integer, local_hour integer, push boolean, mail boolean
)
language sql stable security definer set search_path = public, auth as $$
  select p.id, u.email::text, p.first_name, p.streak_current,
         (select count(*)::integer from public.flashcards f where f.user_id = p.id and f.due_at <= now()),
         extract(hour from now() at time zone p.timezone)::integer,
         coalesce(np.channel_push, true), coalesce(np.channel_email, true)
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.notification_preferences np on np.user_id = p.id
   where coalesce(np.reminders, true)
     and u.email_confirmed_at is not null
     and (p.last_study_date is null or p.last_study_date < public.user_today(p.id))
     and extract(hour from now() at time zone p.timezone)::integer
         = coalesce(np.reminder_hour, p.preferred_study_hour, 18)
     and not exists (
       select 1 from public.notifications n
        where n.user_id = p.id and n.category = 'reminder' and n.created_at > now() - interval '20 hours')
$$;


-- ─── Droits d'exécution ───────────────────────────────────────────────────
-- Par défaut Postgres accorde EXECUTE à PUBLIC : on ferme tout, puis on ouvre
-- uniquement les RPC destinées au client.
do $$
declare f text;
begin
  foreach f in array array[
    'notify(uuid,public.notif_category,text,text,text,text,jsonb)',
    'touch_streak(uuid)', 'streak_maintenance()', 'user_stats(uuid)', 'check_achievements(uuid)',
    'unlock_level_rewards(uuid,integer)', 'ensure_league_member(uuid)', 'finalize_league_weeks()',
    'assign_challenges(uuid)', 'bump_challenges(uuid,text,integer)',
    'add_xp(uuid,integer,text,text,numeric,boolean)', 'refresh_study_habits()', 'users_due_for_reminder()',
    'user_today(uuid)']
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

grant execute on function public.get_my_gamification()            to authenticated;
grant execute on function public.get_league_leaderboard()         to authenticated;
grant execute on function public.get_global_leaderboard(integer)  to authenticated;
grant execute on function public.get_my_league_history()          to authenticated;
grant execute on function public.mark_notifications_read(uuid[])  to authenticated;
