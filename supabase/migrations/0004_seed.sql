-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0004 · DONNÉES DE RÉFÉRENCE
-- Plans · 45 badges · défis quotidiens/hebdomadaires · récompenses
-- (ré-exécutable : upsert)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Plans ─────────────────────────────────────────────────────────────────
insert into public.plans (id, name, price_eur_cents, price_xaf, documents_per_month, quizzes_per_month,
                          ai_requests_per_day, max_questions, max_file_mb, features) values
  ('free',    'Gratuit',   0,    0,     5,    30,   20,  10, 10, '{"exam_mode":false,"adaptive":false,"detailed_summary":false,"team_members":1}'),
  ('pro',     'Pro',       900,  5900,  null, null, 200, 30, 20, '{"exam_mode":true,"adaptive":true,"detailed_summary":true,"team_members":1}'),
  ('premium', 'Premium',   1900, 12500, null, null, 1000, 50, 20, '{"exam_mode":true,"adaptive":true,"detailed_summary":true,"team_members":10,"teacher_dashboard":true,"priority_support":true}')
on conflict (id) do update set
  name = excluded.name, price_eur_cents = excluded.price_eur_cents, price_xaf = excluded.price_xaf,
  documents_per_month = excluded.documents_per_month, quizzes_per_month = excluded.quizzes_per_month,
  ai_requests_per_day = excluded.ai_requests_per_day, max_questions = excluded.max_questions,
  max_file_mb = excluded.max_file_mb, features = excluded.features;

-- ─── 45 badges ─────────────────────────────────────────────────────────────
insert into public.achievements (id, name, description, icon, category, tier, metric, threshold, xp_reward, secret, sort) values
  -- Démarrage
  ('first_steps',      'Premiers pas',              'Créer ton compte RelBrain.',                         '👣', 'Démarrage',   'bronze',  'xp_total',             100,   10, false, 1),
  ('email_verified',   'Adresse confirmée',         'Valider ton adresse email.',                         '✉️', 'Démarrage',   'bronze',  'email_verified',         1,   20, false, 2),
  ('profile_complete', 'Carte d''identité',         'Compléter ton profil (photo, niveau, pays).',        '🪪', 'Démarrage',   'bronze',  'profile_complete',       1,   30, false, 3),
  ('first_document',   'Premier cours',             'Importer et analyser ton premier document.',         '📄', 'Démarrage',   'bronze',  'documents_uploaded',     1,   20, false, 4),
  ('first_quiz',       'Baptême du quiz',           'Terminer ton premier quiz.',                         '🎯', 'Démarrage',   'bronze',  'quizzes_completed',      1,   20, false, 5),
  ('first_card',       'Première carte',            'Réviser ta première flashcard.',                     '🃏', 'Démarrage',   'bronze',  'cards_reviewed',         1,   10, false, 6),
  -- Quiz
  ('quiz_10',          'Habitué·e des quiz',        'Terminer 10 quiz.',                                  '📝', 'Quiz',        'bronze',  'quizzes_completed',     10,   50, false, 10),
  ('quiz_50',          'Machine à quiz',            'Terminer 50 quiz.',                                  '⚙️', 'Quiz',        'argent',  'quizzes_completed',     50,  150, false, 11),
  ('quiz_200',         'Encyclopédie vivante',      'Terminer 200 quiz.',                                 '📚', 'Quiz',        'or',      'quizzes_completed',    200,  400, false, 12),
  ('perfect_1',        'Sans faute',                'Réussir un quiz de 5 questions ou plus à 100 %.',    '💯', 'Quiz',        'bronze',  'perfect_quizzes',        1,   50, false, 13),
  ('perfect_10',       'Perfectionniste',           'Réussir 10 quiz sans aucune erreur.',                '🏅', 'Quiz',        'argent',  'perfect_quizzes',       10,  200, false, 14),
  ('correct_100',      'Cent bonnes réponses',      'Donner 100 bonnes réponses.',                        '✅', 'Quiz',        'bronze',  'correct_answers',      100,   50, false, 15),
  ('correct_1000',     'Mille éclairs',             'Donner 1 000 bonnes réponses.',                      '⚡', 'Quiz',        'or',      'correct_answers',     1000,  300, false, 16),
  ('fast_1',           'Éclair',                    'Réussir un quiz de 10+ questions à 80 % en moins de 15 s par question.', '🏎️', 'Quiz', 'argent', 'fast_quizzes', 1, 60, false, 17),
  -- Flashcards
  ('cards_50',         'Mémoire en marche',         'Réviser 50 flashcards.',                             '🧠', 'Flashcards',  'bronze',  'cards_reviewed',        50,   30, false, 20),
  ('cards_500',        'Mémoire d''éléphant',       'Réviser 500 flashcards.',                            '🐘', 'Flashcards',  'argent',  'cards_reviewed',       500,  150, false, 21),
  ('cards_2000',       'Palais de la mémoire',      'Réviser 2 000 flashcards.',                          '🏛️', 'Flashcards',  'or',      'cards_reviewed',      2000,  400, false, 22),
  ('cards_10000',      'Archiviste',                'Réviser 10 000 flashcards.',                         '🗄️', 'Flashcards',  'diamant', 'cards_reviewed',     10000, 1000, false, 23),
  ('cards_created_20', 'Artisan des fiches',        'Créer 20 flashcards.',                               '✍️', 'Flashcards',  'bronze',  'cards_created',         20,   30, false, 24),
  ('cards_created_200','Fabrique à fiches',         'Créer 200 flashcards.',                              '🏭', 'Flashcards',  'argent',  'cards_created',        200,  120, false, 25),
  -- Régularité
  ('streak_3',         'Ça chauffe',                'Étudier 3 jours de suite.',                          '🔥', 'Régularité',  'bronze',  'streak_best',            3,   20, false, 30),
  ('streak_7',         'Semaine parfaite',          'Étudier 7 jours de suite.',                          '📅', 'Régularité',  'bronze',  'streak_best',            7,   50, false, 31),
  ('streak_14',        'Deux semaines de feu',      'Étudier 14 jours de suite.',                         '☄️', 'Régularité',  'argent',  'streak_best',           14,  100, false, 32),
  ('streak_30',        'Mois de discipline',        'Étudier 30 jours de suite.',                         '🌙', 'Régularité',  'or',      'streak_best',           30,  250, false, 33),
  ('streak_100',       'Centurion',                 'Étudier 100 jours de suite.',                        '🛡️', 'Régularité',  'diamant', 'streak_best',          100, 1000, false, 34),
  ('streak_365',       'Une année d''étude',        'Étudier 365 jours de suite.',                        '👑', 'Régularité',  'diamant', 'streak_best',          365, 3000, false, 35),
  ('minutes_600',      'Dix heures d''étude',       'Cumuler 10 heures d''étude.',                        '⏳', 'Régularité',  'argent',  'study_minutes',        600,  100, false, 36),
  ('minutes_3000',     'Cinquante heures',          'Cumuler 50 heures d''étude.',                        '🕰️', 'Régularité',  'or',      'study_minutes',       3000,  400, false, 37),
  -- Progression
  ('level_5',          'Niveau 5',                  'Atteindre le niveau 5.',                             '⭐', 'Progression', 'bronze',  'level',                  5,    0, false, 40),
  ('level_10',         'Niveau 10',                 'Atteindre le niveau 10.',                            '🌟', 'Progression', 'argent',  'level',                 10,    0, false, 41),
  ('level_20',         'Niveau 20',                 'Atteindre le niveau 20.',                            '💫', 'Progression', 'or',      'level',                 20,    0, false, 42),
  ('level_30',         'Niveau 30',                 'Atteindre le niveau 30.',                            '🌠', 'Progression', 'diamant', 'level',                 30,    0, false, 43),
  ('xp_10000',         '10 000 XP',                 'Cumuler 10 000 XP.',                                 '💎', 'Progression', 'or',      'xp_total',           10000,    0, false, 44),
  ('mastered_1',       'Maîtrise',                  'Atteindre 80 % de maîtrise dans une matière.',       '🎓', 'Progression', 'argent',  'mastered_subjects',      1,  150, false, 45),
  -- Ligues
  ('league_promo_1',   'Promotion !',               'Être promu·e dans la ligue supérieure.',             '🚀', 'Ligues',      'bronze',  'league_promotions',      1,   50, false, 50),
  ('league_or',        'Ligue Or',                  'Atteindre la ligue Or.',                             '🥇', 'Ligues',      'argent',  'league_rank',            3,  100, false, 51),
  ('league_diamant',   'Ligue Diamant',             'Atteindre la ligue Diamant.',                        '💠', 'Ligues',      'or',      'league_rank',            5,  300, false, 52),
  ('league_maitre',    'Maître',                    'Atteindre la ligue Maître.',                         '🏆', 'Ligues',      'diamant', 'league_rank',            6, 1000, false, 53),
  ('weekly_win',       'Champion·ne de la semaine', 'Terminer 1er·e de ta ligue.',                        '🥇', 'Ligues',      'or',      'weekly_wins',            1,  200, false, 54),
  -- Exploration
  ('documents_10',     'Bibliothécaire',            'Analyser 10 documents.',                             '🗂️', 'Exploration', 'argent',  'documents_uploaded',    10,  100, false, 60),
  ('subjects_5',       'Esprit curieux',            'Étudier 5 matières différentes.',                    '🧭', 'Exploration', 'argent',  'subjects_count',         5,  100, false, 61),
  ('chat_50',          'Grand·e questionneur·se',   'Poser 50 questions à l''assistant.',                 '💬', 'Exploration', 'bronze',  'chat_messages',         50,   50, false, 62),
  ('challenges_30',    'Relever les défis',         'Réussir 30 défis.',                                  '🎖️', 'Exploration', 'argent',  'challenges_completed',  30,  150, false, 63),
  -- Secrets
  ('night_owl',        'Chouette de minuit',        'Étudier 5 fois entre 22 h et 4 h.',                  '🦉', 'Secrets',     'argent',  'night_sessions',         5,   50, true,  70),
  ('early_bird',       'Lève-tôt',                  'Étudier 5 fois entre 4 h et 7 h.',                   '🐓', 'Secrets',     'argent',  'early_sessions',         5,   50, true,  71)
on conflict (id) do update set
  name = excluded.name, description = excluded.description, icon = excluded.icon, category = excluded.category,
  tier = excluded.tier, metric = excluded.metric, threshold = excluded.threshold, xp_reward = excluded.xp_reward,
  secret = excluded.secret, sort = excluded.sort;

-- ─── Défis ─────────────────────────────────────────────────────────────────
insert into public.challenge_templates (id, period, title, description, icon, metric, target, xp_reward, weight) values
  ('daily_xp_50',      'daily',  'Gagne 50 XP',               'Toute activité compte.',                       '⚡', 'xp',                 50,  15, 3),
  ('daily_xp_120',     'daily',  'Gagne 120 XP',              'Une belle journée d''étude.',                  '🔋', 'xp',                120,  30, 2),
  ('daily_quiz_1',     'daily',  'Termine un quiz',           'N''importe quelle matière.',                   '🎯', 'quiz_completed',      1,  20, 3),
  ('daily_quiz_2',     'daily',  'Termine 2 quiz',            'Deux sessions, deux fois plus de mémoire.',    '🎯', 'quiz_completed',      2,  35, 2),
  ('daily_cards_20',   'daily',  'Révise 20 flashcards',      'La révision espacée fait le travail.',         '🃏', 'cards_reviewed',     20,  20, 3),
  ('daily_cards_50',   'daily',  'Révise 50 flashcards',      'Mode marathon.',                               '🃏', 'cards_reviewed',     50,  40, 1),
  ('daily_minutes_15', 'daily',  'Étudie 15 minutes',         'Quiz, cartes ou lecture.',                     '⏱️', 'study_minutes',      15,  20, 3),
  ('daily_correct_15', 'daily',  'Donne 15 bonnes réponses',  'Vise juste.',                                  '✅', 'correct_answers',    15,  25, 2),
  ('daily_perfect',    'daily',  'Un quiz sans faute',        '5 questions minimum, 100 % de réussite.',      '💯', 'perfect_quiz',        1,  40, 1),
  ('weekly_xp_1000',   'weekly', 'Gagne 1 000 XP',            'Cette semaine.',                               '🏔️', 'xp',               1000, 200, 2),
  ('weekly_quiz_10',   'weekly', 'Termine 10 quiz',           'Cette semaine.',                               '📝', 'quiz_completed',     10, 200, 2),
  ('weekly_cards_300', 'weekly', 'Révise 300 cartes',         'Cette semaine.',                               '🧠', 'cards_reviewed',    300, 250, 1),
  ('weekly_docs_3',    'weekly', 'Importe 3 cours',           'Cette semaine.',                               '📄', 'documents_uploaded',  3, 150, 1)
on conflict (id) do update set
  title = excluded.title, description = excluded.description, icon = excluded.icon, metric = excluded.metric,
  target = excluded.target, xp_reward = excluded.xp_reward, weight = excluded.weight, period = excluded.period;

-- ─── Récompenses (thèmes, avatars, titres) ─────────────────────────────────
insert into public.reward_items (id, kind, name, description, unlock_level, unlock_achievement, premium_only) values
  ('theme_cahier',      'theme',  'Cahier',            'Le thème RelBrain d''origine.',          1,    null,         false),
  ('theme_nuit',        'theme',  'Nuit étoilée',      'Pour les révisions tardives.',           5,    null,         false),
  ('theme_savane',      'theme',  'Savane',            'Ocres et verts chauds.',                 10,   null,         false),
  ('theme_ocean',       'theme',  'Océan',             'Bleus profonds, esprit clair.',          15,   null,         false),
  ('theme_aurore',      'theme',  'Aurore',            'Offert après 30 jours de série.',        null, 'streak_30',  false),
  ('theme_or',          'theme',  'Feuille d''or',     'Exclusif Premium.',                      null, null,         true),
  ('avatar_lion',       'avatar', 'Lion',              'Courage et constance.',                  8,    null,         false),
  ('avatar_baobab',     'avatar', 'Baobab',            'Des racines solides.',                   12,   null,         false),
  ('avatar_fusee',      'avatar', 'Fusée',             'Décollage imminent.',                    20,   null,         false),
  ('avatar_hibou',      'avatar', 'Hibou',             'Pour les chouettes de minuit.',          null, 'night_owl',  false),
  ('title_curieux',     'title',  'Curieux·se',        null,                                     1,    null,         false),
  ('title_studieux',    'title',  'Studieux·se',       null,                                     5,    null,         false),
  ('title_stratege',    'title',  'Stratège',          null,                                     10,   null,         false),
  ('title_erudit',      'title',  'Érudit·e',          null,                                     20,   null,         false),
  ('title_legende',     'title',  'Légende',           null,                                     30,   null,         false),
  ('title_centurion',   'title',  'Centurion',         null,                                     null, 'streak_100', false),
  ('title_champion',    'title',  'Champion·ne',       null,                                     null, 'weekly_win', false)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, description = excluded.description,
  unlock_level = excluded.unlock_level, unlock_achievement = excluded.unlock_achievement, premium_only = excluded.premium_only;
