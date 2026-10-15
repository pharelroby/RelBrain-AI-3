-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0003 · APPRENTISSAGE
-- Inscription · quiz notés côté serveur · flashcards SM-2 · sessions d'étude
-- · progression par matière · points faibles · recommandations · quotas
-- · limitation de débit · recherche sémantique (RAG).
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ INSCRIPTION : profil + abonnement gratuit + préférences + bonus ══════
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, first_name, last_name, display_name, avatar_url, country, institution,
                               school_level, field, language, goals, phone)
  values (
    new.id,
    nullif(m ->> 'first_name', ''),
    nullif(m ->> 'last_name', ''),
    coalesce(nullif(m ->> 'display_name', ''), nullif(m ->> 'full_name', ''), nullif(m ->> 'name', '')),
    nullif(m ->> 'avatar_url', ''),
    nullif(m ->> 'country', ''),
    nullif(m ->> 'institution', ''),
    case when m ->> 'school_level' in ('college','lycee','bts','licence','master','prepa','autre') then m ->> 'school_level' end,
    nullif(m ->> 'field', ''),
    case when m ->> 'language' = 'en' then 'en' else 'fr' end,
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(m -> 'goals') = 'array' then m -> 'goals' else '[]'::jsonb end)), '{}'),
    nullif(m ->> 'phone', '')
  )
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, plan, status) values (new.id, 'free', 'active') on conflict (user_id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict (user_id) do nothing;

  -- La gamification ne doit jamais bloquer une inscription
  begin
    perform public.add_xp(new.id, 100, 'welcome', null, 1, false);
    perform public.notify(new.id, 'system', 'Bienvenue sur RelBrain 👋',
      'Importe ton premier cours : l''IA en tire un quiz, des flashcards et un résumé.', '🧠', 'relbrain-documents.html');
  exception when others then
    raise warning 'handle_new_user gamification: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Bonus de validation d'email (+50 XP, une seule fois)
create or replace function public.handle_email_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles set email_verified_bonus = true where id = new.id and not email_verified_bonus;
    if found then
      begin
        perform public.add_xp(new.id, 50, 'email_verified', null, 1, true);
      exception when others then
        raise warning 'handle_email_confirmed: %', sqlerrm;
      end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.handle_email_confirmed();


-- ═══ PROGRESSION PAR MATIÈRE ═══════════════════════════════════════════════
-- Maîtrise = moyenne pondérée : 70 % justesse récente (50 dernières réponses)
-- + 30 % régularité (cartes revues). Bornée 0–100.
create or replace function public.update_subject_progress(
  p_user uuid, p_subject text, p_questions integer default 0, p_correct integer default 0,
  p_cards integer default 0, p_seconds integer default 0, p_quiz boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare v_subject text := coalesce(nullif(trim(p_subject), ''), 'Général'); v_acc numeric; v_cards integer;
begin
  insert into public.user_progress (user_id, subject) values (p_user, v_subject) on conflict do nothing;
  update public.user_progress
     set quizzes_taken      = quizzes_taken + case when p_quiz then 1 else 0 end,
         questions_answered = questions_answered + p_questions,
         correct_answers    = correct_answers + p_correct,
         cards_reviewed     = cards_reviewed + p_cards,
         study_seconds      = study_seconds + greatest(p_seconds, 0),
         last_activity_at   = now()
   where user_id = p_user and subject = v_subject;

  select avg(case when is_correct then 1.0 else 0.0 end) into v_acc from (
    select is_correct from public.quiz_answers
     where user_id = p_user and coalesce(subject, 'Général') = v_subject and is_correct is not null
     order by answered_at desc limit 50) x;
  select cards_reviewed into v_cards from public.user_progress where user_id = p_user and subject = v_subject;

  update public.user_progress
     set mastery = least(100, round((coalesce(v_acc, 0) * 70 + least(coalesce(v_cards, 0), 100) * 0.3)::numeric, 2))
   where user_id = p_user and subject = v_subject;
end $$;


-- ═══ QUIZ : démarrage, correction question par question, clôture ═════════
create or replace function public.start_quiz_attempt(p_quiz uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_id uuid; v_max integer; v_count integer;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.quizzes where id = p_quiz and user_id = v_user) then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  select coalesce(sum(points), 0), count(*) into v_max, v_count from public.quiz_questions where quiz_id = p_quiz;
  insert into public.quiz_attempts (quiz_id, user_id, max_score, total_count)
  values (p_quiz, v_user, v_max, v_count) returning id into v_id;
  return v_id;
end $$;

-- Normalisation pour les réponses courtes : minuscules, sans accents ni ponctuation
create or replace function public.normalize_answer(p text) returns text
language sql immutable as $$
  select trim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇàâäáãéèêëíìîïóòôöõúùûüçœŒæÆ',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuucoOaA')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- p_answer : {"index":1} | {"value":"…"} | {"number":3.14} | {"self_grade":true}
create or replace function public.check_answer(p_attempt uuid, p_question uuid, p_answer jsonb, p_time_ms integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); q record; a record; v_ok boolean; v_subject text; v_given text; v_num numeric;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.quiz_attempts where id = p_attempt and user_id = v_user;
  if not found then raise exception 'attempt_not_found' using errcode = 'P0002'; end if;
  if a.completed_at is not null then raise exception 'attempt_closed' using errcode = 'P0001'; end if;
  select * into q from public.quiz_questions where id = p_question and quiz_id = a.quiz_id;
  if not found then raise exception 'question_not_found' using errcode = 'P0002'; end if;
  select subject into v_subject from public.quizzes where id = a.quiz_id;

  if q.type in ('qcm', 'vf') then
    v_ok := (p_answer ->> 'index')::integer = (q.correct_answer ->> 'index')::integer;
  elsif q.type = 'court' then
    v_given := public.normalize_answer(p_answer ->> 'value');
    v_ok := v_given <> '' and (
      v_given = public.normalize_answer(q.correct_answer ->> 'value')
      or exists (select 1 from jsonb_array_elements_text(coalesce(q.correct_answer -> 'accepted', '[]')) acc
                  where public.normalize_answer(acc) = v_given));
  elsif q.type = 'calcul' then
    begin
      v_num := replace(p_answer ->> 'number', ',', '.')::numeric;
      v_ok := abs(v_num - (q.correct_answer ->> 'number')::numeric)
              <= coalesce((q.correct_answer ->> 'tolerance')::numeric, 0.01 * greatest(abs((q.correct_answer ->> 'number')::numeric), 1));
    exception when others then v_ok := false;
    end;
  else -- 'texte' : auto-évaluation après lecture du corrigé modèle
    v_ok := case when p_answer ? 'self_grade' then (p_answer ->> 'self_grade')::boolean else null end;
  end if;

  insert into public.quiz_answers (attempt_id, question_id, user_id, answer, is_correct, concept, subject, time_ms)
  values (p_attempt, p_question, v_user, p_answer, v_ok, q.concept, v_subject, p_time_ms)
  on conflict (attempt_id, question_id) do update
     set is_correct = excluded.is_correct, answer = excluded.answer, time_ms = excluded.time_ms
   where public.quiz_answers.is_correct is null and excluded.is_correct is not null;
  -- La première réponse notée fait foi ; seule une réponse encore non notée
  -- (rédaction en attente d'auto-évaluation) peut être complétée.

  -- Rédaction : le corrigé modèle n'est révélé qu'après une tentative écrite
  if q.type = 'texte' and v_ok is null and not (p_answer ? 'text') then
    raise exception 'answer_required' using errcode = '22023';
  end if;

  -- On renvoie la réponse réellement enregistrée (empêche de « re-tenter »)
  select is_correct into v_ok from public.quiz_answers where attempt_id = p_attempt and question_id = p_question;

  return jsonb_build_object(
    'correct', v_ok,
    'correct_answer', q.correct_answer,
    'explanation', q.explanation,
    'concept', q.concept
  );
end $$;

create or replace function public.finish_quiz_attempt(p_attempt uuid, p_duration_seconds integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); a record; z record; v_quiz record;
  v_correct integer; v_answered integer; v_score integer; v_base integer; v_bonus numeric := 1;
  v_xp jsonb; v_perfect boolean; v_fast boolean; v_diff_xp integer; v_streak jsonb;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.quiz_attempts where id = p_attempt and user_id = v_user for update;
  if not found then raise exception 'attempt_not_found' using errcode = 'P0002'; end if;
  if a.completed_at is not null then
    return jsonb_build_object('already_completed', true, 'score', a.score, 'correct', a.correct_count, 'total', a.total_count, 'xp', jsonb_build_object('awarded', a.xp_awarded));
  end if;
  select * into v_quiz from public.quizzes where id = a.quiz_id;

  select count(*) filter (where qa.is_correct), count(*),
         coalesce(sum(q.points) filter (where qa.is_correct), 0)
    into v_correct, v_answered, v_score
    from public.quiz_answers qa join public.quiz_questions q on q.id = qa.question_id
   where qa.attempt_id = p_attempt;

  -- XP de base selon la difficulté (cf. écran de configuration du quiz)
  v_diff_xp := case v_quiz.difficulty when 'facile' then 6 when 'moyen' then 10 when 'difficile' then 14 else 20 end;
  v_base := v_correct * v_diff_xp + (v_answered - v_correct) * 2;   -- l'effort compte aussi
  v_perfect := a.total_count >= 5 and v_correct = a.total_count;
  v_fast := p_duration_seconds is not null and a.total_count >= 5 and p_duration_seconds < a.total_count * 15 and v_correct >= a.total_count * 0.8;
  if v_perfect then v_bonus := v_bonus + 0.5; end if;   -- bonus de perfection
  if v_fast then v_bonus := v_bonus + 0.25; end if;     -- bonus de vitesse

  update public.quiz_attempts
     set completed_at = now(), score = v_score, correct_count = v_correct,
         duration_seconds = least(greatest(coalesce(p_duration_seconds, 0), 0), 6 * 3600)
   where id = p_attempt;

  insert into public.study_sessions (user_id, kind, document_id, subject, started_at, ended_at, duration_seconds, items_count, meta)
  values (v_user, 'quiz', v_quiz.document_id, v_quiz.subject, a.started_at, now(),
          least(greatest(coalesce(p_duration_seconds, extract(epoch from now() - a.started_at)::integer), 0), 6 * 3600),
          v_answered, jsonb_build_object('quiz_id', a.quiz_id, 'attempt_id', p_attempt));

  perform public.update_subject_progress(v_user, v_quiz.subject, v_answered, v_correct, 0, coalesce(p_duration_seconds, 0), true);
  v_streak := public.touch_streak(v_user);
  perform public.bump_challenges(v_user, 'quiz_completed', 1);
  perform public.bump_challenges(v_user, 'correct_answers', v_correct);
  if v_perfect then perform public.bump_challenges(v_user, 'perfect_quiz', 1); end if;
  perform public.bump_challenges(v_user, 'study_minutes', greatest(coalesce(p_duration_seconds, 0) / 60, 1));

  v_xp := public.add_xp(v_user, v_base, 'quiz', p_attempt::text, v_bonus, true);
  update public.quiz_attempts set xp_awarded = coalesce((v_xp ->> 'awarded')::integer, 0) where id = p_attempt;
  update public.study_sessions set xp_earned = coalesce((v_xp ->> 'awarded')::integer, 0)
   where user_id = v_user and meta ->> 'attempt_id' = p_attempt::text;

  return jsonb_build_object(
    'score', v_score, 'max_score', a.max_score, 'correct', v_correct, 'total', a.total_count, 'answered', v_answered,
    'perfect', v_perfect, 'fast', v_fast, 'xp', v_xp, 'streak', v_streak,
    'weak_concepts', (
      select coalesce(jsonb_agg(distinct q.concept), '[]'::jsonb)
        from public.quiz_answers qa join public.quiz_questions q on q.id = qa.question_id
       where qa.attempt_id = p_attempt and qa.is_correct is false and q.concept is not null)
  );
end $$;


-- ═══ FLASHCARDS : algorithme SM-2 ══════════════════════════════════════════
-- Boutons → qualité SM-2 : again=1, hard=3, good=4, easy=5
--   EF' = EF + (0,1 − (5−q)(0,08 + (5−q)0,02)), EF ≥ 1,3
--   q < 3 : répétitions = 0, intervalle = 1 jour (carte « oubliée »)
--   sinon : 1 j → 6 j → intervalle × EF (×1,3 en plus si « facile »)
create or replace function public.review_flashcard(p_card uuid, p_rating text, p_time_ms integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); c record; v_q integer; v_ef numeric; v_int integer; v_reps integer;
  v_due timestamptz; v_subject text; v_xp jsonb; v_today_reviews integer;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_rating not in ('again','hard','good','easy') then raise exception 'invalid_rating' using errcode = '22023'; end if;
  select * into c from public.flashcards where id = p_card and user_id = v_user for update;
  if not found then raise exception 'card_not_found' using errcode = 'P0002'; end if;

  v_q := case p_rating when 'again' then 1 when 'hard' then 3 when 'good' then 4 else 5 end;
  v_ef := greatest(1.3, c.ease_factor + (0.1 - (5 - v_q) * (0.08 + (5 - v_q) * 0.02)));

  if v_q < 3 then
    v_reps := 0; v_int := 0; v_due := now() + interval '10 minutes';   -- revue dans la séance
  else
    v_reps := c.repetitions + 1;
    v_int := case when v_reps = 1 then 1 when v_reps = 2 then 6 else ceil(greatest(c.interval_days, 1) * v_ef)::integer end;
    if p_rating = 'hard' then v_int := greatest(1, ceil(v_int * 0.6)::integer); end if;
    if p_rating = 'easy' then v_int := ceil(v_int * 1.3)::integer; end if;
    v_int := least(v_int, 365);
    v_due := now() + make_interval(days => v_int);
  end if;

  update public.flashcards
     set ease_factor = v_ef, interval_days = v_int, repetitions = v_reps,
         lapses = lapses + case when v_q < 3 and c.repetitions > 0 then 1 else 0 end,
         due_at = v_due, last_reviewed_at = now()
   where id = p_card;

  insert into public.flashcard_reviews (card_id, user_id, rating, quality, prev_interval, new_interval, ease_factor, time_ms)
  values (p_card, v_user, p_rating, v_q, c.interval_days, v_int, v_ef, p_time_ms);

  select subject into v_subject from public.flashcard_decks where id = c.deck_id;
  perform public.update_subject_progress(v_user, v_subject, 0, 0, 1, coalesce(p_time_ms, 0) / 1000, false);
  perform public.touch_streak(v_user);
  perform public.bump_challenges(v_user, 'cards_reviewed', 1);

  -- 2 XP par carte (3 si facile), plafonné à 200 cartes rémunérées par jour
  select count(*) into v_today_reviews from public.flashcard_reviews
   where user_id = v_user and reviewed_at >= (public.user_today(v_user)::timestamp at time zone (select timezone from public.profiles where id = v_user));
  if v_today_reviews <= 200 then
    v_xp := public.add_xp(v_user, case when p_rating = 'easy' then 3 else 2 end, 'flashcard', p_card::text, 1, true);
  end if;

  return jsonb_build_object('interval_days', v_int, 'due_at', v_due, 'ease_factor', v_ef, 'repetitions', v_reps, 'xp', coalesce(v_xp, '{}'::jsonb));
end $$;

-- Cartes à réviser maintenant (priorité : en retard, puis nouvelles)
create or replace function public.get_due_flashcards(p_deck uuid default null, p_limit integer default 30)
returns setof public.flashcards
language sql stable security invoker set search_path = public as $$
  select * from public.flashcards
   where user_id = auth.uid() and due_at <= now() and (p_deck is null or deck_id = p_deck)
   order by (repetitions = 0), due_at
   limit least(greatest(p_limit, 1), 200)
$$;


-- ═══ SESSIONS D'ÉTUDE (lecture, chat, révision libre) ══════════════════════
create or replace function public.log_study_session(
  p_kind text, p_duration_seconds integer, p_document uuid default null, p_subject text default null,
  p_items integer default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_secs integer := least(greatest(coalesce(p_duration_seconds, 0), 0), 4 * 3600); v_xp jsonb;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_kind not in ('reading','chat','summary','flashcards') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if p_document is not null and not exists (select 1 from public.documents where id = p_document and user_id = v_user) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  insert into public.study_sessions (user_id, kind, document_id, subject, started_at, ended_at, duration_seconds, items_count)
  values (v_user, p_kind, p_document, p_subject, now() - make_interval(secs => v_secs), now(), v_secs, greatest(p_items, 0));
  if v_secs >= 120 then
    perform public.touch_streak(v_user);
    perform public.bump_challenges(v_user, 'study_minutes', v_secs / 60);
    -- 1 XP par minute de lecture active, max 30 par session
    v_xp := public.add_xp(v_user, least(v_secs / 60, 30), 'study_' || p_kind, p_document::text, 1, true);
  end if;
  return coalesce(v_xp, jsonb_build_object('awarded', 0));
end $$;


-- ═══ POINTS FAIBLES & RECOMMANDATIONS ══════════════════════════════════════
create or replace view public.v_concept_stats with (security_invoker = true) as
  select user_id, subject, concept,
         count(*)                                   as attempts,
         count(*) filter (where is_correct)         as correct,
         round(avg(case when is_correct then 100.0 else 0 end), 1) as accuracy,
         max(answered_at)                           as last_seen
    from public.quiz_answers
   where concept is not null and is_correct is not null
   group by user_id, subject, concept;

create or replace function public.get_weak_points(p_limit integer default 8) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select subject, concept, attempts, correct, accuracy, last_seen
      from public.v_concept_stats
     where user_id = auth.uid() and attempts >= 2 and accuracy < 70
     order by accuracy asc, last_seen desc
     limit least(greatest(p_limit, 1), 30)
  ) x
$$;

create or replace function public.get_recommendations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_recs jsonb := '[]'::jsonb; v_due integer; w record; d record; p record;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into p from public.profiles where id = v_user;

  -- 1. Série en danger
  if p.streak_current > 0 and p.last_study_date < public.user_today(v_user) then
    v_recs := v_recs || jsonb_build_array(jsonb_build_object('kind','streak','priority',100,'icon','🔥',
      'title','Sauve ta série de ' || p.streak_current || ' jours',
      'body','Une session de 5 minutes suffit aujourd''hui.', 'cta','Réviser 5 min', 'link','relbrain-flashcards.html'));
  end if;

  -- 2. Cartes dues (révision espacée)
  select count(*) into v_due from public.flashcards where user_id = v_user and due_at <= now();
  if v_due > 0 then
    v_recs := v_recs || jsonb_build_array(jsonb_build_object('kind','due_cards','priority',90,'icon','🃏',
      'title', v_due || ' carte' || case when v_due > 1 then 's' else '' end || ' à réviser',
      'body','C''est le moment optimal pour les mémoriser durablement.', 'cta','Réviser', 'link','relbrain-flashcards.html'));
  end if;

  -- 3. Points faibles → quiz ciblé
  for w in select * from public.v_concept_stats where user_id = v_user and attempts >= 2 and accuracy < 70
            order by accuracy, last_seen desc limit 2 loop
    v_recs := v_recs || jsonb_build_array(jsonb_build_object('kind','weak_point','priority',80 - w.accuracy / 10,'icon','🎯',
      'title','Point faible : ' || w.concept,
      'body', w.accuracy || ' % de réussite sur ' || w.attempts || ' questions (' || coalesce(w.subject, 'Général') || ').',
      'cta','Quiz ciblé', 'link','relbrain-quiz-setup.html?focus=' || replace(w.concept, ' ', '+'),
      'concept', w.concept, 'subject', w.subject));
  end loop;

  -- 4. Documents oubliés depuis 7 jours
  for d in select id, title from public.documents
            where user_id = v_user and status = 'ready'
              and coalesce(last_opened_at, created_at) < now() - interval '7 days'
            order by coalesce(last_opened_at, created_at) limit 2 loop
    v_recs := v_recs || jsonb_build_array(jsonb_build_object('kind','stale_document','priority',60,'icon','📄',
      'title','Reviens sur « ' || d.title || ' »', 'body','Non révisé depuis plus d''une semaine.',
      'cta','Quiz express', 'link','relbrain-quiz-setup.html?doc=' || d.id, 'document_id', d.id));
  end loop;

  -- 5. Premier pas
  if not exists (select 1 from public.documents where user_id = v_user) then
    v_recs := v_recs || jsonb_build_array(jsonb_build_object('kind','onboarding','priority',95,'icon','✨',
      'title','Importe ton premier cours', 'body','PDF, Word, photo de notes… l''IA prépare tout en 30 secondes.',
      'cta','Importer', 'link','relbrain-documents.html'));
  end if;

  return (select coalesce(jsonb_agg(r order by (r ->> 'priority')::numeric desc), '[]'::jsonb) from jsonb_array_elements(v_recs) r);
end $$;

-- Historique d'activité (page historique : filtres + graphiques)
create or replace function public.get_activity(p_days integer default 30, p_kind text default null, p_subject text default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'minutes', coalesce(s.minutes, 0), 'xp', coalesce(x.xp, 0)) order by d.day), '[]'::jsonb)
        from (select gs::date as day
                from generate_series((current_date - (least(greatest(p_days, 1), 365) - 1))::timestamp, current_date::timestamp, interval '1 day') gs) d
        left join (select started_at::date as day, sum(duration_seconds) / 60 as minutes from public.study_sessions
                    where user_id = auth.uid() and (p_kind is null or kind = p_kind) and (p_subject is null or subject = p_subject)
                    group by 1) s on s.day = d.day
        left join (select created_at::date as day, sum(amount) as xp from public.xp_events where user_id = auth.uid() group by 1) x on x.day = d.day
    ),
    'sessions', (
      select coalesce(jsonb_agg(row_to_json(s) order by s.started_at desc), '[]'::jsonb) from (
        select id, kind, subject, document_id, started_at, duration_seconds, items_count, xp_earned
          from public.study_sessions
         where user_id = auth.uid() and started_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
           and (p_kind is null or kind = p_kind) and (p_subject is null or subject = p_subject)
         order by started_at desc limit 100) s
    ),
    'subjects', (select coalesce(jsonb_agg(row_to_json(u) order by u.mastery desc), '[]'::jsonb)
                   from public.user_progress u where u.user_id = auth.uid())
  )
$$;


-- ═══ QUOTAS PAR PLAN ═══════════════════════════════════════════════════════
create or replace function public.quota_status(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce((select plan from public.subscriptions where user_id = p_user and status in ('active','trialing')
                      and (current_period_end is null or current_period_end > now())), 'free') as plan
  ), pl as (select p.* from public.plans p, s where p.id = s.plan)
  select jsonb_build_object(
    'plan', (select plan from s),
    'documents', jsonb_build_object('limit', (select documents_per_month from pl),
       'used', (select count(*) from public.documents where user_id = p_user and created_at >= date_trunc('month', now()))),
    'quizzes',   jsonb_build_object('limit', (select quizzes_per_month from pl),
       'used', (select count(*) from public.quizzes where user_id = p_user and created_at >= date_trunc('month', now()))),
    'ai_requests', jsonb_build_object('limit', (select ai_requests_per_day from pl),
       'used', (select count(*) from public.ai_usage where user_id = p_user and created_at >= now() - interval '24 hours')),
    'max_questions', (select max_questions from pl),
    'max_file_mb', (select max_file_mb from pl),
    'features', (select features from pl)
  )
$$;

create or replace function public.get_my_quota() returns jsonb
language sql stable security definer set search_path = public as $$ select public.quota_status(auth.uid()) $$;


-- ═══ LIMITATION DE DÉBIT (fenêtre fixe, atomique) ══════════════════════════
-- Renvoie true si la requête est autorisée.
create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  insert into public.rate_limits as rl (key, count, window_start) values (p_key, 1, now())
  on conflict (key) do update
     set count = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.count + 1 end,
         window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end
  returning count into v_count;
  return v_count <= p_max;
end $$;

create or replace function public.purge_rate_limits() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin delete from public.rate_limits where window_start < now() - interval '1 day'; get diagnostics n = row_count; return n; end $$;


-- ═══ RAG : recherche sémantique dans les chunks d'un document ══════════════
create or replace function public.match_document_chunks(
  p_query_embedding vector(1536), p_document uuid default null, p_user uuid default null, p_count integer default 6
) returns table (id bigint, document_id uuid, chunk_index integer, content text, similarity double precision)
language sql stable security definer set search_path = public as $$
  select c.id, c.document_id, c.chunk_index, c.content, 1 - (c.embedding <=> p_query_embedding) as similarity
    from public.document_chunks c
   where c.user_id = coalesce(p_user, auth.uid())
     and (p_document is null or c.document_id = p_document)
     and c.embedding is not null
   order by c.embedding <=> p_query_embedding
   limit least(greatest(p_count, 1), 20)
$$;


-- ─── Droits d'exécution ───────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'handle_new_user()', 'handle_email_confirmed()',
    'update_subject_progress(uuid,text,integer,integer,integer,integer,boolean)',
    'quota_status(uuid)', 'rate_limit_hit(text,integer,integer)', 'purge_rate_limits()',
    'match_document_chunks(vector,uuid,uuid,integer)']
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

grant execute on function public.start_quiz_attempt(uuid)                         to authenticated;
grant execute on function public.check_answer(uuid,uuid,jsonb,integer)            to authenticated;
grant execute on function public.finish_quiz_attempt(uuid,integer)                to authenticated;
grant execute on function public.review_flashcard(uuid,text,integer)              to authenticated;
grant execute on function public.get_due_flashcards(uuid,integer)                 to authenticated;
grant execute on function public.log_study_session(text,integer,uuid,text,integer) to authenticated;
grant execute on function public.get_weak_points(integer)                         to authenticated;
grant execute on function public.get_recommendations()                            to authenticated;
grant execute on function public.get_activity(integer,text,text)                  to authenticated;
grant execute on function public.get_my_quota()                                   to authenticated;
revoke execute on function public.get_my_quota() from anon;
