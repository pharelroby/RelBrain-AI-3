-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0001 · SCHÉMA PRINCIPAL
-- Tables, index, RLS, privilèges de colonnes, stockage, realtime.
-- À exécuter dans l'ordre (supabase db push, ou SQL Editor du dashboard).
--
-- Principes de sécurité :
--   · RLS activé sur TOUTES les tables du schéma public.
--   · Un utilisateur ne voit / ne modifie que ses propres lignes.
--   · Les colonnes sensibles (XP, niveau, plan, bonnes réponses…) ne sont
--     jamais modifiables par le client : seules les fonctions SECURITY DEFINER
--     et la clé service_role (routes /api) peuvent les écrire.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
create extension if not exists vector;      -- RAG : embeddings des chunks

-- ─── Types ────────────────────────────────────────────────────────────────
do $$ begin
  create type public.plan_tier       as enum ('free','pro','premium');
  create type public.doc_status      as enum ('pending','processing','ready','failed');
  create type public.league_tier     as enum ('bronze','argent','or','platine','diamant','maitre');
  create type public.notif_category  as enum ('reminder','badge','goal','league','streak','system','payment','ai');
  create type public.payment_status  as enum ('pending','succeeded','failed','refunded','canceled');
  create type public.payment_provider as enum ('stripe','orange_money','mtn_momo','manual');
  create type public.sub_status      as enum ('active','trialing','past_due','canceled','expired');
exception when duplicate_object then null; end $$;

-- ─── Utilitaire updated_at ────────────────────────────────────────────────
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;


-- ═══ PROFILS ═══════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  first_name        text check (char_length(first_name) <= 60),
  last_name         text check (char_length(last_name)  <= 60),
  display_name      text check (char_length(display_name) <= 60),
  avatar_url        text,
  phone             text check (char_length(phone) <= 30),
  country           text check (char_length(country) <= 60),
  institution       text check (char_length(institution) <= 120),
  school_level      text check (school_level in ('college','lycee','bts','licence','master','prepa','autre')),
  field             text check (char_length(field) <= 120),
  language          text not null default 'fr' check (language in ('fr','en')),
  goals             text[] not null default '{}',
  timezone          text not null default 'Africa/Douala',
  -- Gamification (écriture serveur uniquement)
  xp                integer not null default 0 check (xp >= 0),
  level             integer not null default 1 check (level >= 1),
  weekly_xp         integer not null default 0,
  league_tier       public.league_tier not null default 'bronze',
  streak_current    integer not null default 0,
  streak_best       integer not null default 0,
  streak_freezes    integer not null default 1 check (streak_freezes between 0 and 5),
  last_study_date   date,
  title             text,                         -- titre équipé (récompense)
  theme             text not null default 'cahier',
  preferred_study_hour smallint check (preferred_study_hour between 0 and 23), -- appris automatiquement
  email_verified_bonus boolean not null default false,
  onboarding_done   boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();
create index if not exists profiles_weekly_xp_idx on public.profiles (league_tier, weekly_xp desc);


-- ═══ PLANS & ABONNEMENTS ══════════════════════════════════════════════════
create table if not exists public.plans (
  id                   public.plan_tier primary key,
  name                 text not null,
  price_eur_cents      integer not null,
  price_xaf            integer not null,
  documents_per_month  integer,            -- null = illimité
  quizzes_per_month    integer,
  ai_requests_per_day  integer not null,
  max_questions        integer not null,
  max_file_mb          integer not null,
  features             jsonb not null default '{}'
);

create table if not exists public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null unique references auth.users(id) on delete cascade,
  plan                      public.plan_tier not null default 'free' references public.plans(id),
  status                    public.sub_status not null default 'active',
  provider                  public.payment_provider,
  provider_customer_id      text,
  provider_subscription_id  text,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.tg_set_updated_at();

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider        public.payment_provider not null,
  provider_ref    text not null,
  plan            public.plan_tier not null references public.plans(id),
  period_months   integer not null default 1 check (period_months in (1,12)),
  amount          integer not null,         -- en plus petite unité (centimes, ou XAF)
  currency        text not null check (currency in ('EUR','XAF','USD')),
  status          public.payment_status not null default 'pending',
  phone           text,                      -- Mobile Money
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (provider, provider_ref)
);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.tg_set_updated_at();
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);


-- ═══ DOCUMENTS ════════════════════════════════════════════════════════════
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 200),
  subject         text check (char_length(subject) <= 60),
  source          text not null default 'upload' check (source in ('upload','note','text')),
  file_path       text,                       -- {user_id}/{uuid}.{ext} dans le bucket « documents »
  file_name       text,
  mime_type       text,
  size_bytes      bigint check (size_bytes <= 20 * 1024 * 1024),
  page_count      integer,
  word_count      integer,
  language        text,
  status          public.doc_status not null default 'pending',
  status_message  text,
  progress        smallint not null default 0 check (progress between 0 and 100),
  summary_short   text,
  key_concepts    jsonb not null default '[]',
  is_favorite     boolean not null default false,
  last_opened_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger documents_updated_at before update on public.documents
  for each row execute function public.tg_set_updated_at();
create index if not exists documents_user_idx on public.documents (user_id, created_at desc);

create table if not exists public.document_chunks (
  id            bigint generated always as identity primary key,
  document_id   uuid not null references public.documents(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  chunk_index   integer not null,
  content       text not null,
  token_count   integer,
  embedding     vector(1536),
  unique (document_id, chunk_index)
);
create index if not exists document_chunks_doc_idx on public.document_chunks (document_id, chunk_index);
create index if not exists document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

create table if not exists public.summaries (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('short','detailed','key_points')),
  content       jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists summaries_doc_idx on public.summaries (document_id, kind);


-- ═══ QUIZ ═════════════════════════════════════════════════════════════════
create table if not exists public.quizzes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  document_id     uuid references public.documents(id) on delete set null,
  title           text not null,
  subject         text,
  source          text not null default 'document' check (source in ('document','text','subject','weak_points')),
  difficulty      text not null default 'moyen' check (difficulty in ('facile','moyen','difficile','expert')),
  question_type   text not null default 'qcm' check (question_type in ('qcm','vf','court','calcul','texte','mixte')),
  question_count  integer not null check (question_count between 1 and 50),
  settings        jsonb not null default '{}',   -- {timer, explain, adapt, shuffle}
  created_at      timestamptz not null default now()
);
create index if not exists quizzes_user_idx on public.quizzes (user_id, created_at desc);

create table if not exists public.quiz_questions (
  id              uuid primary key default gen_random_uuid(),
  quiz_id         uuid not null references public.quizzes(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  position        integer not null,
  type            text not null check (type in ('qcm','vf','court','calcul','texte')),
  prompt          text not null,
  options         jsonb,              -- ["…","…"] pour qcm / vf
  correct_answer  jsonb not null,     -- {index} | {value, accepted[]} | {number, tolerance} | {model}
  explanation     text,
  concept         text,
  difficulty      text,
  points          integer not null default 1,
  unique (quiz_id, position)
);

create table if not exists public.quiz_attempts (
  id                uuid primary key default gen_random_uuid(),
  quiz_id           uuid not null references public.quizzes(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  score             integer not null default 0,
  max_score         integer not null default 0,
  correct_count     integer not null default 0,
  total_count       integer not null default 0,
  duration_seconds  integer,
  xp_awarded        integer not null default 0
);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id, started_at desc);

create table if not exists public.quiz_answers (
  id            bigint generated always as identity primary key,
  attempt_id    uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id   uuid not null references public.quiz_questions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  answer        jsonb,
  is_correct    boolean,
  concept       text,
  subject       text,
  time_ms       integer,
  answered_at   timestamptz not null default now(),
  unique (attempt_id, question_id)
);
create index if not exists quiz_answers_concept_idx on public.quiz_answers (user_id, concept);


-- ═══ FLASHCARDS (SM-2) ════════════════════════════════════════════════════
create table if not exists public.flashcard_decks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid references public.documents(id) on delete set null,
  title         text not null,
  subject       text,
  created_at    timestamptz not null default now()
);

create table if not exists public.flashcards (
  id                uuid primary key default gen_random_uuid(),
  deck_id           uuid not null references public.flashcard_decks(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  front             text not null check (char_length(front) <= 1000),
  back              text not null check (char_length(back) <= 2000),
  concept           text,
  is_favorite       boolean not null default false,
  ease_factor       numeric(4,2) not null default 2.50,
  interval_days     integer not null default 0,
  repetitions       integer not null default 0,
  lapses            integer not null default 0,
  due_at            timestamptz not null default now(),
  last_reviewed_at  timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists flashcards_due_idx on public.flashcards (user_id, due_at);

create table if not exists public.flashcard_reviews (
  id              bigint generated always as identity primary key,
  card_id         uuid not null references public.flashcards(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  rating          text not null check (rating in ('again','hard','good','easy')),
  quality         smallint not null check (quality between 0 and 5),
  prev_interval   integer,
  new_interval    integer,
  ease_factor     numeric(4,2),
  time_ms         integer,
  reviewed_at     timestamptz not null default now()
);
create index if not exists flashcard_reviews_user_idx on public.flashcard_reviews (user_id, reviewed_at desc);


-- ═══ HISTORIQUE & PROGRESSION ═════════════════════════════════════════════
create table if not exists public.study_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  kind              text not null check (kind in ('quiz','flashcards','reading','chat','summary')),
  document_id       uuid references public.documents(id) on delete set null,
  subject           text,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  duration_seconds  integer check (duration_seconds between 0 and 6 * 3600),
  items_count       integer not null default 0,
  xp_earned         integer not null default 0,
  meta              jsonb not null default '{}'
);
create index if not exists study_sessions_user_idx on public.study_sessions (user_id, started_at desc);

create table if not exists public.user_progress (
  user_id             uuid not null references auth.users(id) on delete cascade,
  subject             text not null,
  mastery             numeric(5,2) not null default 0 check (mastery between 0 and 100),
  quizzes_taken       integer not null default 0,
  questions_answered  integer not null default 0,
  correct_answers     integer not null default 0,
  cards_reviewed      integer not null default 0,
  study_seconds       integer not null default 0,
  last_activity_at    timestamptz not null default now(),
  primary key (user_id, subject)
);

create table if not exists public.xp_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount        integer not null,
  base_amount   integer not null,
  multiplier    numeric(4,2) not null default 1,
  reason        text not null,
  source_id     text,
  created_at    timestamptz not null default now()
);
create index if not exists xp_events_user_idx on public.xp_events (user_id, created_at desc);


-- ═══ GAMIFICATION ═════════════════════════════════════════════════════════
create table if not exists public.achievements (
  id            text primary key,
  name          text not null,
  description   text not null,
  icon          text not null,                 -- emoji ou classe Font Awesome
  category      text not null,
  tier          text not null default 'bronze' check (tier in ('bronze','argent','or','diamant')),
  metric        text not null,                 -- clé de user_stats()
  threshold     numeric not null,
  xp_reward     integer not null default 0,
  secret        boolean not null default false,
  sort          integer not null default 0
);

create table if not exists public.user_achievements (
  user_id         uuid not null references auth.users(id) on delete cascade,
  achievement_id  text not null references public.achievements(id) on delete cascade,
  unlocked_at     timestamptz not null default now(),
  seen            boolean not null default false,
  primary key (user_id, achievement_id)
);

create table if not exists public.league_weeks (
  id            bigint generated always as identity primary key,
  week_start    date not null unique,          -- lundi
  finalized_at  timestamptz
);
create table if not exists public.league_groups (
  id            bigint generated always as identity primary key,
  week_id       bigint not null references public.league_weeks(id) on delete cascade,
  tier          public.league_tier not null,
  member_count  integer not null default 0
);
create index if not exists league_groups_week_tier_idx on public.league_groups (week_id, tier);
create table if not exists public.league_members (
  group_id      bigint not null references public.league_groups(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  weekly_xp     integer not null default 0,
  final_rank    integer,
  outcome       text check (outcome in ('promoted','stayed','demoted')),
  joined_at     timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists league_members_user_idx on public.league_members (user_id);

create table if not exists public.challenge_templates (
  id            text primary key,
  period        text not null check (period in ('daily','weekly')),
  title         text not null,
  description   text not null,
  icon          text not null,
  metric        text not null check (metric in ('xp','quiz_completed','perfect_quiz','cards_reviewed','study_minutes','documents_uploaded','correct_answers','chat_messages')),
  target        integer not null,
  xp_reward     integer not null,
  weight        integer not null default 1
);
create table if not exists public.user_challenges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  template_id   text not null references public.challenge_templates(id) on delete cascade,
  period        text not null,
  period_start  date not null,
  metric        text not null,
  target        integer not null,
  progress      integer not null default 0,
  xp_reward     integer not null,
  completed_at  timestamptz,
  unique (user_id, template_id, period_start)
);
create index if not exists user_challenges_user_idx on public.user_challenges (user_id, period_start desc);

create table if not exists public.reward_items (
  id                  text primary key,
  kind                text not null check (kind in ('theme','avatar','title','streak_freeze')),
  name                text not null,
  description         text,
  unlock_level        integer,
  unlock_achievement  text references public.achievements(id),
  premium_only        boolean not null default false
);
create table if not exists public.user_rewards (
  user_id       uuid not null references auth.users(id) on delete cascade,
  reward_id     text not null references public.reward_items(id) on delete cascade,
  unlocked_at   timestamptz not null default now(),
  primary key (user_id, reward_id)
);


-- ═══ NOTIFICATIONS ════════════════════════════════════════════════════════
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  category        public.notif_category not null,
  title           text not null,
  body            text,
  icon            text,
  link            text,
  data            jsonb not null default '{}',
  read_at         timestamptz,
  push_sent_at    timestamptz,
  email_sent_at   timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table if not exists public.notification_preferences (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  reminders           boolean not null default true,
  badges              boolean not null default true,
  goals               boolean not null default true,
  league              boolean not null default true,
  streak              boolean not null default true,
  ai                  boolean not null default true,   -- documents analysés, recommandations
  product             boolean not null default false,
  channel_push        boolean not null default true,
  channel_email       boolean not null default true,
  reminder_hour       smallint check (reminder_hour between 0 and 23),  -- null = automatique
  quiet_start         smallint not null default 22 check (quiet_start between 0 and 23),
  quiet_end           smallint not null default 7  check (quiet_end between 0 and 23),
  updated_at          timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.tg_set_updated_at();

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now()
);


-- ═══ ASSISTANT IA ═════════════════════════════════════════════════════════
create table if not exists public.ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid references public.documents(id) on delete set null,
  title         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger ai_conversations_updated_at before update on public.ai_conversations
  for each row execute function public.tg_set_updated_at();
create table if not exists public.ai_messages (
  id                bigint generated always as identity primary key,
  conversation_id   uuid not null references public.ai_conversations(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              text not null check (role in ('user','assistant','system')),
  content           text not null,
  tokens            integer,
  created_at        timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, id);

create table if not exists public.ai_usage (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  route               text not null,
  model               text not null,
  prompt_tokens       integer not null default 0,
  completion_tokens   integer not null default 0,
  total_tokens        integer not null default 0,
  cost_usd            numeric(10,6) not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists ai_usage_user_day_idx on public.ai_usage (user_id, created_at desc);


-- ═══ DIVERS : contact, limitation de débit, clés API publiques ════════════
create table if not exists public.contact_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null check (char_length(name) between 1 and 120),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  topic         text not null default 'contact' check (topic in ('contact','support','bug','feature','partnership','press','privacy')),
  subject       text check (char_length(subject) <= 200),
  message       text not null check (char_length(message) between 10 and 5000),
  page_url      text,
  user_agent    text,
  status        text not null default 'new' check (status in ('new','in_progress','closed')),
  created_at    timestamptz not null default now()
);

create table if not exists public.rate_limits (
  key           text primary key,
  count         integer not null default 0,
  window_start  timestamptz not null default now()
);

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  key_prefix    text not null,         -- 8 premiers caractères, affichables
  key_hash      text not null unique,  -- sha256 de la clé complète (jamais stockée en clair)
  scopes        text[] not null default '{read}',
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','plans','subscriptions','payments','documents','document_chunks','summaries',
    'quizzes','quiz_questions','quiz_attempts','quiz_answers','flashcard_decks','flashcards',
    'flashcard_reviews','study_sessions','user_progress','xp_events','achievements',
    'user_achievements','league_weeks','league_groups','league_members','challenge_templates',
    'user_challenges','reward_items','user_rewards','notifications','notification_preferences',
    'push_subscriptions','ai_conversations','ai_messages','ai_usage','contact_messages',
    'rate_limits','api_keys']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Catalogues publics en lecture
create policy "plans lisibles par tous"            on public.plans               for select using (true);
create policy "badges lisibles"                    on public.achievements        for select to authenticated using (not secret or exists (select 1 from public.user_achievements ua where ua.achievement_id = achievements.id and ua.user_id = auth.uid()));
create policy "défis lisibles"                     on public.challenge_templates for select to authenticated using (true);
create policy "récompenses lisibles"               on public.reward_items        for select to authenticated using (true);

-- Lignes personnelles : lecture
create policy "own select" on public.profiles             for select to authenticated using (id = auth.uid());
create policy "own select" on public.subscriptions        for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.payments             for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.xp_events            for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.user_achievements    for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.user_challenges      for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.user_rewards         for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.user_progress        for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.quiz_attempts        for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.quiz_answers         for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.flashcard_reviews    for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.ai_usage             for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.document_chunks      for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.summaries            for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.league_members       for select to authenticated using (user_id = auth.uid());

-- Lignes personnelles : CRUD complet côté client
create policy "own all" on public.documents                for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own all" on public.flashcard_decks          for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own all" on public.study_sessions           for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own all" on public.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own all" on public.push_subscriptions       for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own all" on public.ai_conversations         for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own select" on public.ai_messages           for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.quizzes               for select to authenticated using (user_id = auth.uid());
create policy "own delete" on public.quizzes               for delete to authenticated using (user_id = auth.uid());
create policy "own select" on public.quiz_questions        for select to authenticated using (user_id = auth.uid());
create policy "own select" on public.api_keys              for select to authenticated using (user_id = auth.uid());
create policy "own revoke" on public.api_keys              for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Flashcards : le client crée / édite le contenu, jamais les champs SM-2
create policy "own select" on public.flashcards for select to authenticated using (user_id = auth.uid());
create policy "own insert" on public.flashcards for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.flashcard_decks d where d.id = deck_id and d.user_id = auth.uid()));
create policy "own update" on public.flashcards for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own delete" on public.flashcards for delete to authenticated using (user_id = auth.uid());

-- Profils : mise à jour limitée aux colonnes « identité » (voir GRANT ci-dessous)
create policy "own update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Notifications : lecture + marquer comme lu
create policy "own select" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "own update" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own delete" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Contact : tout le monde peut écrire (anon inclus), personne ne relit côté client
create policy "contact insert" on public.contact_messages for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- rate_limits, league_weeks, league_groups : aucune policy → inaccessibles au client.


-- ─── Privilèges de colonnes ────────────────────────────────────────────────
revoke update on public.profiles from authenticated, anon;
grant  update (first_name, last_name, display_name, avatar_url, phone, country, institution,
               school_level, field, language, goals, timezone, theme, title, onboarding_done)
  on public.profiles to authenticated;

revoke update on public.flashcards from authenticated, anon;
grant  update (front, back, concept, is_favorite, deck_id) on public.flashcards to authenticated;

revoke update on public.notifications from authenticated, anon;
grant  update (read_at) on public.notifications to authenticated;

revoke update on public.api_keys from authenticated, anon;
grant  update (revoked_at, name) on public.api_keys to authenticated;

-- Les bonnes réponses ne sont JAMAIS lisibles directement : passer par check_answer()
revoke select on public.quiz_questions from authenticated, anon;
grant  select (id, quiz_id, user_id, position, type, prompt, options, concept, difficulty, points)
  on public.quiz_questions to authenticated;

-- Documents : créés et analysés par le serveur (/api/documents/process) ;
-- le client ne peut modifier que les métadonnées d'affichage.
revoke insert, update on public.documents from authenticated, anon;
grant  update (title, subject, is_favorite, last_opened_at) on public.documents to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- STOCKAGE (Supabase Storage)
-- ═══════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 20971520, array[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'text/plain', 'text/markdown',
     'image/png', 'image/jpeg', 'image/webp']),
  ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = excluded.public;

-- Chaque utilisateur n'accède qu'à son dossier : documents/{auth.uid()}/…
create policy "documents: lecture perso"  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents: dépôt perso"    on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents: suppression perso" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: lecture publique" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars: dépôt perso"      on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: remplacement perso" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: suppression perso" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);


-- ═══════════════════════════════════════════════════════════════════════════
-- REALTIME : statut d'analyse des documents + notifications en direct
-- ═══════════════════════════════════════════════════════════════════════════
do $$ begin
  alter publication supabase_realtime add table public.documents;
  alter publication supabase_realtime add table public.notifications;
exception when others then null; end $$;
