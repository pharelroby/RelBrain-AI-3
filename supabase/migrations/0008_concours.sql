-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0008 · CONCOURS & ANNALES
-- Catalogue des concours des grandes écoles (IUT, Polytechniques, ESSEC…),
-- leurs niveaux d'entrée (1re année, 3e année…) et les épreuves des années
-- passées (sujet + corrigé). Lecture pour les élèves connectés ; l'ajout
-- d'épreuves se fait par l'équipe (clé service_role ou éditeur SQL).
--
-- Ajouter une épreuve :
--   1. Déposer le PDF dans le bucket « annales » :
--        annales/{slug-concours}/{code-niveau}/{année}-{matiere}-sujet.pdf
--        annales/{slug-concours}/{code-niveau}/{année}-{matiere}-corrige.pdf
--   2. insert into public.concours_annales (level_id, year, subject, format,
--        duration_minutes, sujet_path, corrige_path, content_text)
--      select id, 2025, 'Mathématiques', 'mixte', 180,
--        'enspy/1re/2025-maths-sujet.pdf', 'enspy/1re/2025-maths-corrige.pdf',
--        '…texte du sujet (pour générer un quiz)…'
--      from public.concours_levels
--      where code = '1re' and concours_id = (select id from public.concours where slug = 'enspy');
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ CONCOURS ═════════════════════════════════════════════════════════════
create table if not exists public.concours (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  short_name  text not null,                       -- « ENSP Yaoundé »
  abbr        text not null check (length(abbr) <= 6), -- badge de la carte : « ENSPY »
  name        text not null,                       -- nom officiel complet
  category    text not null check (category in ('ingenieur','technologie','commerce','universite')),
  city        text,
  country     text not null default 'Cameroun',
  description text,
  website     text,
  color       text not null default '#7c3aed',     -- couleur de la carte
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger concours_updated_at before update on public.concours
  for each row execute function public.tg_set_updated_at();

-- ═══ NIVEAUX D'ENTRÉE ═════════════════════════════════════════════════════
create table if not exists public.concours_levels (
  id           uuid primary key default gen_random_uuid(),
  concours_id  uuid not null references public.concours(id) on delete cascade,
  code         text not null check (code ~ '^[a-z0-9-]+$'),  -- '1re', '3e'
  label        text not null,                                 -- « 1re année »
  requirement  text,                                          -- « Baccalauréat C, D, E, F ou GCE A-Level »
  sort_order   integer not null default 1,
  unique (concours_id, code)
);
create index if not exists concours_levels_concours_idx on public.concours_levels (concours_id, sort_order);

-- ═══ ÉPREUVES (ANNALES) ═══════════════════════════════════════════════════
create table if not exists public.concours_annales (
  id               uuid primary key default gen_random_uuid(),
  level_id         uuid not null references public.concours_levels(id) on delete cascade,
  year             integer not null check (year between 1990 and 2100),
  session          text,                                      -- « Session normale », « Session de juillet »…
  subject          text not null,                             -- « Mathématiques », « Physique »…
  format           text not null default 'mixte' check (format in ('qcm','redaction','mixte')),
  duration_minutes integer check (duration_minutes > 0),
  coefficient      numeric(4,1),
  sujet_path       text,                                      -- chemin dans le bucket « annales »
  corrige_path     text,
  content_text     text,                                      -- texte du sujet, pour « S'entraîner »
  has_text         boolean generated always as (content_text is not null and length(content_text) > 0) stored,
  is_published     boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique nulls not distinct (level_id, year, subject, session)
);
-- Liste d'un niveau, de la plus récente à la plus ancienne
create index if not exists concours_annales_level_year_idx on public.concours_annales (level_id, year desc, subject);
create trigger concours_annales_updated_at before update on public.concours_annales
  for each row execute function public.tg_set_updated_at();

-- ═══ SÉCURITÉ (RLS) ═══════════════════════════════════════════════════════
alter table public.concours         enable row level security;
alter table public.concours_levels  enable row level security;
alter table public.concours_annales enable row level security;

create policy "concours lisibles" on public.concours for select to authenticated using (is_active);
create policy "niveaux lisibles"  on public.concours_levels for select to authenticated
  using (exists (select 1 from public.concours c where c.id = concours_id and c.is_active));
create policy "annales lisibles"  on public.concours_annales for select to authenticated
  using (is_published and exists (select 1 from public.concours_levels l join public.concours c on c.id = l.concours_id
                                  where l.id = level_id and c.is_active));
-- Aucune politique d'écriture : seul service_role (qui ignore RLS) ajoute ou modifie.
revoke insert, update, delete on public.concours, public.concours_levels, public.concours_annales from authenticated, anon;

-- ═══ STOCKAGE : bucket privé « annales », lecture pour les élèves connectés ══
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('annales', 'annales', false, 26214400, array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = excluded.public;

create policy "annales: lecture élèves" on storage.objects for select to authenticated
  using (bucket_id = 'annales');

-- ═══ CATALOGUE INITIAL ════════════════════════════════════════════════════
insert into public.concours (slug, short_name, abbr, name, category, city, description, color, sort_order) values
  ('iut-douala',      'IUT de Douala', 'IUT',   'Institut Universitaire de Technologie de Douala',                  'technologie', 'Douala',  'Formations de technicien supérieur (DUT) et de licence de technologie.', '#0ea5e9', 10),
  ('enspd',           'ENSP Douala', 'ENSPD',     'École Nationale Supérieure Polytechnique de Douala',               'ingenieur',   'Douala',  'Cycle d''ingénieur de conception, entrée en 1re ou en 3e année.',         '#7c3aed', 20),
  ('enspy',           'ENSP Yaoundé', 'ENSPY',    'École Nationale Supérieure Polytechnique de Yaoundé',              'ingenieur',   'Yaoundé', 'Cycle d''ingénieur de conception, entrée en 1re ou en 3e année.',         '#6d28d9', 30),
  ('essec-douala',    'ESSEC', 'ESSEC',           'École Supérieure des Sciences Économiques et Commerciales de Douala', 'commerce', 'Douala',  'Gestion, commerce, finance et comptabilité.',                              '#f59e0b', 40),
  ('jfn',             'JFN', 'JFN',             'JFN',                                                               'universite',  null,      null,                                                                        '#ec4899', 50),
  ('saint-jerome',    'Saint Jérôme', 'USJ',    'Université Catholique Saint Jérôme de Douala',                     'universite',  'Douala',  'Ingénierie, santé, gestion et sciences sociales.',                         '#10b981', 60),
  ('ucac',            'UCAC', 'UCAC',            'Université Catholique d''Afrique Centrale',                         'universite',  'Yaoundé', 'Ingénierie, gestion, sciences sociales et santé.',                         '#e11d48', 70)
on conflict (slug) do nothing;

insert into public.concours_levels (concours_id, code, label, requirement, sort_order)
select c.id, l.code, l.label, l.requirement, l.sort_order
from public.concours c
join (values
  ('iut-douala',   '1re', '1re année', 'Baccalauréat ou GCE A-Level', 1),
  ('iut-douala',   '3e',  '3e année',  'DUT, BTS, HND ou Licence 2',  2),
  ('enspd',        '1re', '1re année', 'Baccalauréat C, D, E, F ou GCE A-Level scientifique', 1),
  ('enspd',        '3e',  '3e année',  'Licence 2 ou équivalent (Bac + 2) scientifique', 2),
  ('enspy',        '1re', '1re année', 'Baccalauréat C, D, E, F ou GCE A-Level scientifique', 1),
  ('enspy',        '3e',  '3e année',  'Licence 2 ou équivalent (Bac + 2) scientifique', 2),
  ('essec-douala', '1re', '1re année', 'Baccalauréat ou GCE A-Level', 1),
  ('jfn',          '1re', '1re année', 'Baccalauréat ou GCE A-Level', 1),
  ('saint-jerome', '1re', '1re année', 'Baccalauréat ou GCE A-Level', 1),
  ('ucac',         '1re', '1re année', 'Baccalauréat ou GCE A-Level', 1)
) as l(slug, code, label, requirement, sort_order) on l.slug = c.slug
on conflict (concours_id, code) do nothing;
