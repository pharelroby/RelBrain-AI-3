-- Plan gratuit : jusqu'à 15 questions par quiz (au lieu de 10), demandé après les premiers tests.
update public.plans set max_questions = 15 where id = 'free';
-- Fichiers jusqu'à 20 Mo pour tout le monde (la page d'import annonce « max 20 Mo »).
update public.plans set max_file_mb = 20 where id = 'free';
