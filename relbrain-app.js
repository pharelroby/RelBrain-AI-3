/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — CLIENT APPLICATIF (navigateur)
   ───────────────────────────────────────────────────────────────────────────
   Charge supabase-js, gère la session, expose les données et branche
   l'interface commune (sidebar, avatar, centre de notifications).

   À inclure après relbrain-config.js :
     <script src="relbrain-config.js"></script>
     <script src="relbrain-app.js" defer></script>

   API principale :
     RB.ready                → Promise<client Supabase | null>
     RB.onReady(fn, demoFn)  → fn({ user, profile, game }) quand la session est prête
     RB.auth.*               → signUp, signIn, google, recover, resend, updatePassword, signOut, require
     RB.data.*               → documents, quiz, flashcards, ligues, notifications…
     RB.api(path, opts)      → appel authentifié aux routes /api
     RB.celebrate(result,el) → animations XP / niveau / badges à partir d'une réponse RPC
   Sans configuration (relbrain-config.js vide) : RB.demo === true, les
   pages gardent leurs données d'exemple.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var RB = (window.RB = window.RB || {});
  var C = window.RB_CONFIG || {};
  var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  var API = (C.API_BASE || '').replace(/\/+$/, '');

  RB.configured = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  RB.demo = !RB.configured;
  if (RB.demo) document.documentElement.classList.add('rb-demo');

  /* ─── Utilitaires ─────────────────────────────────────────────────── */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]') && window.supabase) return resolve();
      var s = document.createElement('script');
      s.src = src; s.async = true; s.onload = resolve;
      s.onerror = function () { reject(new Error('Chargement impossible : ' + src)); };
      document.head.appendChild(s);
    });
  }
  function setCookie(name, value, maxAge) {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = name + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + secure;
  }
  var esc = RB.escape = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  /* Pays proposés à l'inscription et dans les concours (le nom français est enregistré dans le profil) */
  RB.COUNTRIES = [
    ['Cameroun', '🇨🇲'], ["Côte d'Ivoire", '🇨🇮'], ['Sénégal', '🇸🇳'], ['Bénin', '🇧🇯'], ['Togo', '🇹🇬'],
    ['Congo (RDC)', '🇨🇩'], ['Congo', '🇨🇬'], ['France', '🇫🇷'], ['Allemagne', '🇩🇪'], ['Suisse', '🇨🇭'], ['Canada', '🇨🇦'], ['Autre', '🌍'],
  ].map(function (c) { return { name: c[0], flag: c[1] }; });
  RB.countryFlag = function (name) { var c = RB.COUNTRIES.filter(function (x) { return x.name === name; })[0]; return c ? c.flag : '🌍'; };
  RB.formatNumber = function (n) { return Number(n || 0).toLocaleString('fr-FR'); };
  RB.timeAgo = function (date) {
    var s = (Date.now() - new Date(date).getTime()) / 1000;
    if (s < 60) return "à l'instant";
    if (s < 3600) return 'il y a ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'il y a ' + Math.floor(s / 3600) + ' h';
    if (s < 172800) return 'hier';
    if (s < 604800) return 'il y a ' + Math.floor(s / 86400) + ' jours';
    return new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };
  function toast(msg, type) { if (RB.toast) RB.toast(msg, type); else if (window.toast) window.toast(msg, type); }

  /* Stockage de session : localStorage + copie du jeton d'accès dans un
     cookie « rb-at » pour que le middleware puisse protéger les pages. */
  var storage = {
    getItem: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: function (k, v) {
      try { localStorage.setItem(k, v); } catch (e) {}
      try { var s = JSON.parse(v); if (s && s.access_token) setCookie('rb-at', s.access_token, 7 * 86400); } catch (e) {}
    },
    removeItem: function (k) { try { localStorage.removeItem(k); } catch (e) {} setCookie('rb-at', '', 0); },
  };

  /* ─── Initialisation de Supabase ──────────────────────────────────── */
  RB.ready = RB.configured
    ? loadScript(SUPABASE_JS).then(function () {
        RB.sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
          auth: { storage: storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        RB.sb.auth.onAuthStateChange(function (event, session) {
          if (!session) setCookie('rb-at', '', 0);
          document.dispatchEvent(new CustomEvent('rb:auth', { detail: { event: event, session: session } }));
        });
        return RB.sb;
      }).catch(function (e) { console.error('[RelBrain]', e); return null; })
    : Promise.resolve(null);

  /* ─── Appels API ──────────────────────────────────────────────────── */
  function ApiError(status, code, message, details) {
    this.name = 'ApiError'; this.status = status; this.code = code; this.message = message; this.details = details;
  }
  ApiError.prototype = Object.create(Error.prototype);
  RB.ApiError = ApiError;

  async function accessToken() {
    if (!RB.sb) return null;
    var r = await RB.sb.auth.getSession();
    return r.data.session ? r.data.session.access_token : null;
  }

  RB.api = async function (path, opts) {
    opts = opts || {};
    var method = opts.method || (opts.body ? 'POST' : 'GET');
    var headers = { 'Content-Type': 'application/json' };
    var token = opts.auth === false ? null : await accessToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    var res;
    try {
      res = await fetch(API + path, { method: method, headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch (e) {
      throw new ApiError(0, 'network', 'Connexion impossible. Vérifie ton accès à internet.');
    }
    if (res.status === 401 && !opts._retried && RB.sb) {
      var ref = await RB.sb.auth.refreshSession();
      if (ref.data && ref.data.session) return RB.api(path, Object.assign({}, opts, { _retried: true }));
    }
    if (opts.stream && res.ok) return res;
    var json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok) {
      var err = (json && json.error) || {};
      throw new ApiError(res.status, err.code || 'http_' + res.status, err.message || 'Une erreur est survenue (' + res.status + ').', err.details);
    }
    return json;
  };

  /** Message d'erreur lisible + incitation à passer Pro si quota atteint. */
  RB.handleError = function (err, fallback) {
    var msg = (err && err.message) || fallback || 'Une erreur est survenue.';
    toast(msg, 'error');
    if (err && (err.code === 'quota_exceeded' || err.code === 'feature_locked')) {
      setTimeout(function () { toast('Découvre RelBrain Pro dans Paramètres → Abonnement', 'info'); }, 900);
    }
    if (err && (err.code === 'unauthenticated' || err.code === 'session_expired')) {
      setTimeout(function () { location.href = 'relbrain-login.html?next=' + encodeURIComponent(location.pathname); }, 1200);
    }
    console.warn('[RelBrain]', err);
  };

  /* ─── Authentification ────────────────────────────────────────────── */
  async function directOr(apiCall, direct) {
    try { return await apiCall(); }
    catch (e) {
      // Fonctions /api absentes (hébergement purement statique) → appel direct à Supabase
      if (e && (e.status === 404 || e.status === 405 || e.status === 501 || e.code === 'network' || e.code === 'config_missing' || e.code === 'ai_not_configured')) return direct();
      throw e;
    }
  }

  RB.auth = {
    session: async function () { await RB.ready; if (!RB.sb) return null; return (await RB.sb.auth.getSession()).data.session; },
    user: async function () { var s = await RB.auth.session(); return s ? s.user : null; },

    signUp: async function (o) {
      await RB.ready;
      var redirect = location.origin + '/relbrain-validation-email.html?confirmed=1';
      var r = await directOr(
        function () { return RB.api('/api/auth/signup', { body: { email: o.email, password: o.password, profile: o.profile || {} }, auth: false }); },
        async function () {
          var d = await RB.sb.auth.signUp({ email: o.email, password: o.password, options: { data: o.profile || {}, emailRedirectTo: redirect } });
          if (d.error) throw new ApiError(400, 'signup_failed', /registered/i.test(d.error.message) ? 'Un compte existe déjà avec cette adresse.' : d.error.message);
          return { needs_confirmation: !d.data.session, session: d.data.session };
        }
      );
      if (r.session) await RB.sb.auth.setSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token });
      try { sessionStorage.setItem('rb_signup_email', o.email); } catch (e) {}
      return r;
    },

    signIn: async function (email, password) {
      await RB.ready;
      var r = await directOr(
        function () { return RB.api('/api/auth/login', { body: { email: email, password: password }, auth: false }); },
        async function () {
          var d = await RB.sb.auth.signInWithPassword({ email: email, password: password });
          if (d.error) throw new ApiError(401, /confirm/i.test(d.error.message) ? 'email_not_confirmed' : 'invalid_credentials',
            /confirm/i.test(d.error.message) ? "Ton adresse n'est pas encore validée." : 'Email ou mot de passe incorrect.');
          return d.data.session;
        }
      );
      var set = await RB.sb.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
      if (set.error) throw new ApiError(401, 'session_failed', 'Connexion impossible, réessaie.');
      return set.data.session;
    },

    google: async function (next) {
      await RB.ready;
      var r = await RB.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' + (next || 'relbrain-accueil.html') } });
      if (r.error) throw new ApiError(400, 'oauth_failed', 'Connexion Google indisponible pour le moment.');
    },

    recover: async function (email) {
      await RB.ready;
      return directOr(
        function () { return RB.api('/api/auth/recover', { body: { email: email }, auth: false }); },
        async function () { await RB.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/relbrain-reset-password.html' }); return { ok: true }; }
      );
    },

    resend: async function (email) {
      await RB.ready;
      return directOr(
        function () { return RB.api('/api/auth/resend', { body: { email: email }, auth: false }); },
        async function () { await RB.sb.auth.resend({ type: 'signup', email: email }); return { ok: true }; }
      );
    },

    updatePassword: async function (password) {
      await RB.ready;
      var r = await RB.sb.auth.updateUser({ password: password });
      if (r.error) throw new ApiError(400, 'update_failed', /same/i.test(r.error.message) ? "Choisis un mot de passe différent de l'ancien." : 'Lien expiré ou invalide. Redemande un email de réinitialisation.');
      return r.data.user;
    },

    signOut: async function (redirect) {
      await RB.ready;
      if (RB.sb) await RB.sb.auth.signOut();
      setCookie('rb-at', '', 0);
      location.href = redirect || 'index.html';
    },

    /** Redirige vers la connexion si aucune session. */
    require: async function () {
      if (RB.demo) return null;
      var s = await RB.auth.session();
      if (!s) {
        location.replace('relbrain-login.html?next=' + encodeURIComponent(location.pathname.replace(/^\//, '') + location.search));
        return new Promise(function () {}); // la page s'arrête là
      }
      return s;
    },
  };

  /* ─── Données ─────────────────────────────────────────────────────── */
  async function uid() { var u = await RB.auth.user(); if (!u) throw new ApiError(401, 'unauthenticated', 'Connecte-toi pour continuer.'); return u.id; }
  function unwrap(r) { if (r.error) throw new ApiError(400, r.error.code || 'db_error', r.error.message); return r.data; }
  async function rpc(name, args) { await RB.ready; return unwrap(await RB.sb.rpc(name, args || {})); }
  async function registerDoc(args) {
    await RB.ready;
    var r = await RB.sb.rpc('register_document', args);
    if (r.error) {
      var m = r.error.message || '';
      throw new ApiError(400, m, /rate_limited/.test(m) ? 'Trop d\'imports en peu de temps. Réessaie dans un moment.'
        : /empty_document/.test(m) ? 'Écris au moins quelques lignes (100 caractères).' : "L'enregistrement du document a échoué.");
    }
    return { document_id: r.data.document_id, document: { id: r.data.document_id, title: args.p_title, status: 'pending' }, status: 'pending', xp: r.data.xp, fallback: true };
  }

  var ALLOWED = {
    'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'text/plain': 'txt', 'text/markdown': 'md',
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  };
  var EXT_MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

  RB.data = {
    profile: async function () { await RB.ready; return unwrap(await RB.sb.from('profiles').select('*').eq('id', await uid()).single()); },
    updateProfile: async function (patch) { await RB.ready; return unwrap(await RB.sb.from('profiles').update(patch).eq('id', await uid()).select().single()); },
    uploadAvatar: async function (file) {
      await RB.ready;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new ApiError(415, 'bad_type', 'Image JPG, PNG ou WEBP uniquement.');
      if (file.size > 2 * 1024 * 1024) throw new ApiError(413, 'too_large', 'Image trop lourde (2 Mo maximum).');
      var id = await uid();
      var path = id + '/avatar-' + Date.now() + '.' + ALLOWED[file.type];
      unwrap(await RB.sb.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type }));
      var url = RB.sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      await RB.data.updateProfile({ avatar_url: url });
      return url;
    },
    gamification: function () { return rpc('get_my_gamification'); },
    quota: function () { return rpc('get_my_quota'); },
    recommendations: function () { return rpc('get_recommendations'); },
    weakPoints: function (limit) { return rpc('get_weak_points', { p_limit: limit || 8 }); },
    activity: function (days, kind, subject) { return rpc('get_activity', { p_days: days || 30, p_kind: kind || null, p_subject: subject || null }); },
    logSession: function (kind, seconds, documentId, subject, items) {
      return rpc('log_study_session', { p_kind: kind, p_duration_seconds: Math.round(seconds), p_document: documentId || null, p_subject: subject || null, p_items: items || 0 });
    },

    documents: {
      list: async function () {
        await RB.ready;
        return unwrap(await RB.sb.from('documents')
          .select('id,title,subject,source,status,status_message,progress,page_count,word_count,size_bytes,mime_type,file_name,is_favorite,created_at,last_opened_at,summary_short,key_concepts')
          .order('created_at', { ascending: false }));
      },
      get: async function (id) { await RB.ready; return unwrap(await RB.sb.from('documents').select('*').eq('id', id).single()); },
      validate: function (file, maxMb) {
        var ext = (file.name.split('.').pop() || '').toLowerCase();
        var mime = ALLOWED[file.type] ? file.type : EXT_MIME[ext];
        if (!mime) throw new ApiError(415, 'unsupported_type', 'Format non pris en charge. Formats acceptés : PDF, DOCX, PPTX, TXT, MD, PNG, JPG, WEBP.');
        var max = (maxMb || 20) * 1024 * 1024;
        if (file.size > max) throw new ApiError(413, 'file_too_large', 'Fichier trop volumineux (' + (maxMb || 20) + ' Mo maximum).');
        if (file.size === 0) throw new ApiError(400, 'empty_file', 'Ce fichier est vide.');
        return mime;
      },
      upload: async function (file, o) {
        o = o || {};
        await RB.ready;
        var mime = RB.data.documents.validate(file, o.maxMb);
        var id = await uid();
        var ext = ALLOWED[mime] || 'bin';
        var uuid = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
        var path = id + '/' + uuid + '.' + ext;
        if (o.onStage) o.onStage('upload');
        var up = await RB.sb.storage.from('documents').upload(path, file, { contentType: mime, upsert: false });
        if (up.error) throw new ApiError(400, 'upload_failed', /mime|type/i.test(up.error.message) ? 'Format refusé par le stockage.' : /size|large/i.test(up.error.message) ? 'Fichier trop volumineux (20 Mo maximum).' : "L'envoi du fichier a échoué. Réessaie.");
        if (o.onStage) o.onStage('process');
        var title = o.title || file.name.replace(/\.[^.]+$/, '');
        return directOr(
          function () { return RB.api('/api/documents/process', { body: { path: path, file_name: file.name, title: o.title || undefined, subject: o.subject || undefined } }); },
          // Sans fonctions /api (hébergement statique) : le document est enregistré, l'analyse IA attendra
          function () { return registerDoc({ p_title: title, p_path: path, p_file_name: file.name, p_mime: mime, p_size: file.size, p_subject: o.subject || null }); }
        );
      },
      /** Relance l'analyse d'un document resté en attente ou en échec. */
      analyze: function (id) { return RB.api('/api/documents/process', { body: { document_id: id } }); },
      saveNote: function (title, text) {
        return directOr(
          function () { return RB.api('/api/documents/process', { body: { title: title, text: text, source: 'note' } }); },
          function () { return registerDoc({ p_title: title, p_text: text }); }
        );
      },
      remove: function (id) { return RB.api('/api/documents/delete', { body: { id: id } }); },
      toggleFavorite: async function (id, value) { await RB.ready; return unwrap(await RB.sb.from('documents').update({ is_favorite: value }).eq('id', id)); },
      markOpened: async function (id) { await RB.ready; return RB.sb.from('documents').update({ last_opened_at: new Date().toISOString() }).eq('id', id); },
      summary: function (id, kind, regenerate) { return RB.api('/api/ai/summary', { body: { document_id: id, kind: kind || 'short', regenerate: !!regenerate } }); },
      /** Suivi en temps réel du statut d'analyse. */
      subscribe: async function (cb) {
        await RB.ready;
        var id = await uid();
        var ch = RB.sb.channel('rb-docs-' + id)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: 'user_id=eq.' + id }, function (p) { cb(p.new || p.old, p.eventType); })
          .subscribe();
        return function () { RB.sb.removeChannel(ch); };
      },
    },

    quiz: {
      generate: function (o) { return RB.api('/api/ai/quiz', { body: o }); },
      get: async function (id) {
        await RB.ready;
        var quiz = unwrap(await RB.sb.from('quizzes').select('*').eq('id', id).single());
        quiz.questions = unwrap(await RB.sb.from('quiz_questions').select('id,position,type,prompt,options,concept,difficulty,points').eq('quiz_id', id).order('position'));
        return quiz;
      },
      recent: async function (limit) {
        await RB.ready;
        return unwrap(await RB.sb.from('quizzes').select('id,title,subject,difficulty,question_type,question_count,created_at,document_id,quiz_attempts(score,max_score,correct_count,total_count,completed_at)').order('created_at', { ascending: false }).limit(limit || 10));
      },
      start: function (quizId) { return rpc('start_quiz_attempt', { p_quiz: quizId }); },
      check: function (attemptId, questionId, answer, timeMs) { return rpc('check_answer', { p_attempt: attemptId, p_question: questionId, p_answer: answer, p_time_ms: timeMs || null }); },
      finish: function (attemptId, seconds) { return rpc('finish_quiz_attempt', { p_attempt: attemptId, p_duration_seconds: Math.round(seconds || 0) }); },
    },

    flashcards: {
      decks: async function () {
        await RB.ready;
        return unwrap(await RB.sb.from('flashcard_decks').select('id,title,subject,document_id,created_at,flashcards(count)').order('created_at', { ascending: false }));
      },
      cards: async function (deckId) {
        await RB.ready;
        var q = RB.sb.from('flashcards').select('id,deck_id,front,back,concept,is_favorite,due_at,repetitions,lapses,interval_days,ease_factor,last_reviewed_at').order('created_at');
        if (deckId) q = q.eq('deck_id', deckId);
        return unwrap(await q);
      },
      due: function (deckId, limit) { return rpc('get_due_flashcards', { p_deck: deckId || null, p_limit: limit || 50 }); },
      review: function (cardId, rating, timeMs) { return rpc('review_flashcard', { p_card: cardId, p_rating: rating, p_time_ms: timeMs || null }); },
      generate: function (o) { return RB.api('/api/ai/flashcards', { body: o }); },
      toggleFavorite: async function (id, value) { await RB.ready; return unwrap(await RB.sb.from('flashcards').update({ is_favorite: value }).eq('id', id)); },
      create: async function (deckId, front, back) {
        await RB.ready;
        var id = await uid();
        if (!deckId) {
          var existing = unwrap(await RB.sb.from('flashcard_decks').select('id').eq('title', 'Mes cartes').limit(1));
          deckId = existing.length ? existing[0].id : unwrap(await RB.sb.from('flashcard_decks').insert({ user_id: id, title: 'Mes cartes' }).select('id').single()).id;
        }
        return unwrap(await RB.sb.from('flashcards').insert({ deck_id: deckId, user_id: id, front: front, back: back, concept: 'Personnalisé' }).select().single());
      },
      history: async function (limit) {
        await RB.ready;
        return unwrap(await RB.sb.from('flashcard_reviews').select('rating,quality,reviewed_at,time_ms,card_id,flashcards(deck_id,front,flashcard_decks(title))').order('reviewed_at', { ascending: false }).limit(limit || 300));
      },
    },

    leagues: {
      mine: function () { return rpc('get_league_leaderboard'); },
      global: function (limit) { return rpc('get_global_leaderboard', { p_limit: limit || 50 }); },
      history: function () { return rpc('get_my_league_history'); },
      /** scope : global | country | institution · period : all | week */
      board: function (scope, period, limit) { return rpc('get_leaderboard', { p_scope: scope || 'global', p_period: period || 'all', p_limit: limit || 50 }); },
    },

    concours: {
      /** Catalogue : chaque concours avec ses niveaux et le nombre d'épreuves par niveau */
      list: async function () {
        await RB.ready;
        return unwrap(await RB.sb.from('concours')
          .select('id,slug,short_name,abbr,name,category,city,country,description,website,color,sort_order,levels:concours_levels(id,code,label,requirement,sort_order,annales:concours_annales(count))')
          .order('sort_order'));
      },
      get: async function (slug) {
        await RB.ready;
        return unwrap(await RB.sb.from('concours')
          .select('*,levels:concours_levels(id,code,label,requirement,sort_order)')
          .eq('slug', slug).single());
      },
      /** Épreuves d'un niveau, de la plus récente à la plus ancienne */
      annales: async function (levelId) {
        await RB.ready;
        return unwrap(await RB.sb.from('concours_annales')
          .select('id,year,session,subject,format,duration_minutes,coefficient,sujet_path,corrige_path,has_text')
          .eq('level_id', levelId).order('year', { ascending: false }).order('subject'));
      },
      /** Lien temporaire (10 min) vers un PDF du bucket privé « annales » */
      fileUrl: async function (path) {
        await RB.ready;
        var r = await RB.sb.storage.from('annales').createSignedUrl(path, 600);
        if (r.error) throw new ApiError(404, 'file_not_found', 'Ce fichier n\'est pas encore disponible.');
        return r.data.signedUrl;
      },
      /** Copie le texte de l'épreuve dans « Mes documents » pour en tirer un quiz */
      practice: async function (annaleId, title) {
        await RB.ready;
        var a = unwrap(await RB.sb.from('concours_annales').select('content_text').eq('id', annaleId).single());
        if (!a.content_text) throw new ApiError(404, 'no_text', 'Cette épreuve n\'est pas encore prête pour l\'entraînement.');
        return RB.data.documents.saveNote(title, a.content_text);
      },
    },

    achievements: async function () {
      await RB.ready;
      var all = unwrap(await RB.sb.from('achievements').select('*').order('sort'));
      var mine = unwrap(await RB.sb.from('user_achievements').select('achievement_id,unlocked_at'));
      var got = {};
      mine.forEach(function (m) { got[m.achievement_id] = m.unlocked_at; });
      return all.map(function (a) { a.unlocked_at = got[a.id] || null; return a; });
    },

    notifications: {
      list: async function (limit) { await RB.ready; return unwrap(await RB.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit || 30)); },
      markRead: function (ids) { return rpc('mark_notifications_read', { p_ids: ids || null }); },
      subscribe: async function (cb) {
        await RB.ready;
        var id = await uid();
        var ch = RB.sb.channel('rb-notif-' + id)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + id }, function (p) { cb(p.new); })
          .subscribe();
        return function () { RB.sb.removeChannel(ch); };
      },
      prefs: async function () { await RB.ready; return unwrap(await RB.sb.from('notification_preferences').select('*').maybeSingle()); },
      savePrefs: async function (patch) { await RB.ready; patch.user_id = await uid(); return unwrap(await RB.sb.from('notification_preferences').upsert(patch).select().single()); },
    },

    chat: {
      conversations: async function () { await RB.ready; return unwrap(await RB.sb.from('ai_conversations').select('id,title,document_id,updated_at').order('updated_at', { ascending: false }).limit(30)); },
      messages: async function (conversationId) { await RB.ready; return unwrap(await RB.sb.from('ai_messages').select('role,content,created_at').eq('conversation_id', conversationId).order('id')); },
      /** Envoie un message ; onDelta(texte) reçoit la réponse au fil de l'eau. */
      send: async function (message, o) {
        o = o || {};
        var res = await RB.api('/api/ai/chat', { body: { message: message, conversation_id: o.conversationId, document_id: o.documentId }, stream: true });
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '', full = '', conversationId = o.conversationId;
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          var parts = buffer.split('\n\n');
          buffer = parts.pop();
          parts.forEach(function (line) {
            if (line.indexOf('data: ') !== 0) return;
            var evt; try { evt = JSON.parse(line.slice(6)); } catch (e) { return; }
            if (evt.conversation_id) conversationId = evt.conversation_id;
            if (evt.delta) { full += evt.delta; if (o.onDelta) o.onDelta(evt.delta, full); }
            if (evt.error) toast(evt.error, 'error');
          });
        }
        return { text: full, conversationId: conversationId };
      },
    },

    contact: function (payload) {
      return directOr(
        function () { return RB.api('/api/contact', { body: payload }); },
        async function () {
          await RB.ready;
          if (!RB.sb) throw new ApiError(0, 'offline', "L'envoi est indisponible en mode démo.");
          unwrap(await RB.sb.from('contact_messages').insert({ name: payload.name, email: payload.email, topic: payload.topic, subject: payload.subject, message: payload.message, page_url: payload.page_url }));
          return { ok: true };
        }
      );
    },

    account: {
      /** Télécharge toutes les données du compte (JSON) — droit d'accès RGPD. */
      exportData: async function () {
        var token = await accessToken();
        var res = await fetch(API + '/api/account/export', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new ApiError(res.status, 'export_failed', "L'export a échoué. Réessaie dans un instant.");
        var blob = await res.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'relbrain-mes-donnees-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      },
      remove: function () { return RB.api('/api/account/delete', { body: { confirm: 'SUPPRIMER' } }); },
    },

    payments: {
      checkout: function (o) { return RB.api('/api/payments/checkout', { body: o }); },
      status: function (id) { return RB.api('/api/payments/status?id=' + encodeURIComponent(id)); },
      subscription: async function () { await RB.ready; return unwrap(await RB.sb.from('subscriptions').select('*').maybeSingle()); },
      history: async function () { await RB.ready; return unwrap(await RB.sb.from('payments').select('id,provider,plan,period_months,amount,currency,status,created_at').order('created_at', { ascending: false })); },
      /** Attend la validation (Mobile Money) en interrogeant le serveur. */
      waitFor: function (id, onTick, timeoutMs) {
        var started = Date.now();
        return new Promise(function (resolve) {
          (function poll() {
            RB.data.payments.status(id).then(function (r) {
              if (onTick) onTick(r);
              if (r.status !== 'pending' || Date.now() - started > (timeoutMs || 180000)) return resolve(r);
              setTimeout(poll, 3000);
            }).catch(function () { setTimeout(poll, 5000); });
          })();
        });
      },
    },
  };

  /* ─── Notifications push ──────────────────────────────────────────── */
  function urlB64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  RB.push = {
    supported: function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
    enable: async function () {
      if (!RB.push.supported()) throw new ApiError(0, 'unsupported', 'Ton navigateur ne prend pas en charge les notifications push.');
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new ApiError(0, 'denied', 'Notifications refusées. Tu peux les autoriser dans les réglages du navigateur.');
      var reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      var key = C.VAPID_PUBLIC_KEY || (await RB.api('/api/notifications/subscribe', { auth: false })).publicKey;
      if (!key) throw new ApiError(503, 'push_not_configured', "Les notifications push ne sont pas encore configurées sur le serveur.");
      var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
      await RB.api('/api/notifications/subscribe', { body: sub.toJSON() });
      return true;
    },
    disable: async function () {
      var reg = await navigator.serviceWorker.getRegistration('/sw.js');
      var sub = reg && (await reg.pushManager.getSubscription());
      if (sub) { await RB.api('/api/notifications/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
    },
  };

  /* ─── Célébrations (XP, niveau, badges) ───────────────────────────── */
  RB.celebrate = function (result, originEl) {
    if (!result) return;
    var xp = result.xp && typeof result.xp === 'object' ? result.xp : result;
    if (xp && xp.awarded > 0 && RB.motion) {
      var span = (xp.next_level_xp - xp.level_floor_xp) || 1;
      RB.motion.xp(xp.awarded, originEl, { progress: Math.max(0, Math.min(100, ((xp.xp - xp.level_floor_xp) / span) * 100)) });
      if (xp.awarded >= 10 && RB.sound) RB.sound.play('xp');
    }
    var delay = 900;
    if (xp && xp.leveled_up && RB.motion) {
      setTimeout(function () { if (RB.sound) RB.sound.play('levelup'); RB.motion.levelUp(xp.level, { perks: (xp.rewards || []).map(function (r) { return '🎁 ' + r.name; }).concat(xp.level % 5 === 0 ? ['❄️ +1 gel de série'] : []) }); }, delay);
      delay += 600;
    }
    (xp && xp.achievements || []).forEach(function (a, i) {
      setTimeout(function () { if (RB.sound) RB.sound.play('badge'); toast(a.icon + ' Badge débloqué : ' + a.name + (a.xp ? ' · +' + a.xp + ' XP' : ''), 'success'); }, delay + i * 1200);
    });
    (xp && xp.challenges || []).forEach(function (c, i) {
      setTimeout(function () { toast('🎯 Défi réussi · +' + c.xp + ' XP', 'success'); }, delay + 400 + i * 1200);
    });
    if (result.streak && result.streak.extended && result.streak.streak > 1) {
      setTimeout(function () { toast('🔥 Série : ' + result.streak.streak + ' jours !', 'info'); }, delay + 200);
    }
    if (RB.refreshShell) setTimeout(RB.refreshShell, 1500);
  };

  /* ─── Interface commune des pages privées ─────────────────────────── */
  var readyCallbacks = [], shellCtx = null;
  RB.onReady = function (fn, demoFn) {
    if (RB.demo) { if (demoFn) whenDom(demoFn); return; }
    if (shellCtx) fn(shellCtx); else readyCallbacks.push(fn);
  };
  function whenDom(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  function fill(ctx) {
    var p = ctx.profile || {}, g = ctx.game || {};
    var full = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.display_name || (ctx.user.email || '').split('@')[0];
    var initial = (p.first_name || full || '?').trim().charAt(0).toUpperCase();
    var map = {
      name: full, 'first-name': p.first_name || full.split(' ')[0], email: ctx.user.email, initial: initial,
      level: g.level, xp: RB.formatNumber(g.xp), streak: '🔥' + (g.streak || 0), 'streak-count': g.streak || 0,
      'level-line': 'Niveau ' + (g.level || 1) + ' · ' + RB.formatNumber(g.xp) + ' XP',
      league: g.league ? g.league.tier : '',
    };
    Object.keys(map).forEach(function (k) {
      document.querySelectorAll('[data-rb="' + k + '"]').forEach(function (el) { el.textContent = map[k]; });
    });
    document.querySelectorAll('[data-rb="avatar"]').forEach(function (el) {
      if (p.avatar_url) el.innerHTML = '<img src="' + esc(p.avatar_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/>';
      else el.textContent = initial;
    });
    document.querySelectorAll('[data-rb-xp-total]').forEach(function (el) { el.setAttribute('data-rb-xp-total', g.xp || 0); });
    setBadge(g.unread_notifications || 0);
    document.documentElement.classList.remove('rb-loading');
    try { if (p.is_admin) localStorage.setItem('rb-admin', '1'); else localStorage.removeItem('rb-admin'); } catch (e) {}
    if (p.is_admin && !document.querySelector('[data-rb-admin-link]')) {
      var nav = document.querySelector('.sidebar nav');
      if (nav) nav.insertAdjacentHTML('beforeend', '<a href="relbrain-admin.html" class="nav-item" data-rb-admin-link><i class="fa-solid fa-shield-halved nav-icon"></i> Administration</a>');
    }
  }

  function setBadge(n) {
    document.querySelectorAll('[data-rb-action="notifications"]').forEach(function (btn) {
      btn.querySelectorAll('.rb-notif-badge, .bg-rose-500').forEach(function (b) { b.remove(); });
      if (n > 0) {
        var b = document.createElement('span');
        b.className = 'rb-notif-badge'; b.textContent = n > 9 ? '9+' : n;
        btn.appendChild(b);
      }
    });
  }

  var NOTIF_ICON = { reminder: '⏰', badge: '🏅', goal: '🎯', league: '🏆', streak: '🔥', system: '🧠', payment: '💎', ai: '✨' };
  function mountNotificationCenter() {
    document.querySelectorAll('[data-rb-action="notifications"]').forEach(function (btn) {
      if (btn.__rbNotif) return; btn.__rbNotif = true;
      btn.removeAttribute('onclick');
      btn.setAttribute('aria-label', 'Notifications');
      btn.setAttribute('aria-haspopup', 'true');
      var wrap = btn.parentElement;
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      var panel = document.createElement('div');
      panel.className = 'rb-notif-panel';
      panel.innerHTML = '<div class="rb-notif-head"><strong style="font-size:.85rem">Notifications</strong><button type="button" class="rb-btn rb-btn--ghost rb-btn--sm" data-mark-all>Tout marquer comme lu</button></div><div class="rb-notif-list"><div style="padding:1rem"><div class="rb-skeleton rb-skeleton-line"></div><div class="rb-skeleton rb-skeleton-line"></div></div></div>';
      btn.insertAdjacentElement('afterend', panel);
      var list = panel.querySelector('.rb-notif-list');
      async function render() {
        try {
          var items = await RB.data.notifications.list(25);
          if (!items.length) { list.innerHTML = '<p style="padding:1.5rem 1rem;text-align:center;font-size:.75rem;color:var(--rb-muted);font-weight:600">Aucune notification pour l\'instant ✨</p>'; return; }
          list.innerHTML = items.map(function (n) {
            return '<a class="rb-notif-item ' + (n.read_at ? '' : 'unread') + '" href="' + esc(n.link || '#') + '" data-id="' + n.id + '" style="text-decoration:none">' +
              '<span class="rb-notif-icon">' + esc(n.icon || NOTIF_ICON[n.category] || '•') + '</span>' +
              '<span style="min-width:0"><span class="rb-notif-title" style="display:block">' + esc(n.title) + '</span>' +
              (n.body ? '<span class="rb-notif-body" style="display:block">' + esc(n.body) + '</span>' : '') +
              '<span class="rb-notif-body" style="display:block;opacity:.75">' + RB.timeAgo(n.created_at) + '</span></span></a>';
          }).join('');
        } catch (e) { list.innerHTML = '<p style="padding:1rem;font-size:.75rem;color:var(--rb-rose)">Impossible de charger les notifications.</p>'; }
      }
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !panel.classList.contains('open');
        document.querySelectorAll('.rb-notif-panel.open').forEach(function (p) { p.classList.remove('open'); });
        if (open) { panel.classList.add('open'); render(); }
      });
      panel.addEventListener('click', function (e) {
        e.stopPropagation();
        var item = e.target.closest('.rb-notif-item');
        if (item) RB.data.notifications.markRead([item.getAttribute('data-id')]);
        if (e.target.closest('[data-mark-all]')) {
          RB.data.notifications.markRead(null).then(function () { setBadge(0); render(); });
        }
      });
      document.addEventListener('click', function () { panel.classList.remove('open'); });
    });
  }

  function bindActions() {
    document.querySelectorAll('[data-rb-action="logout"]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); RB.auth.signOut(); });
    });
    document.querySelectorAll('[data-rb-action="upgrade"]').forEach(function (b) {
      b.removeAttribute('onclick');
      b.addEventListener('click', function () { location.href = 'relbrain-parametres.html#abonnement'; });
    });
    // « Prendre une note » (sidebar) : la note devient un document analysé par l'IA
    if (document.getElementById('note-modal') && document.getElementById('note-content')) {
      window.saveNote = async function () {
        var title = (document.getElementById('note-title').value || '').trim();
        var content = (document.getElementById('note-content').value || '').trim();
        if (content.replace(/\s/g, '').length < 100) {
          if (RB.motion) RB.motion.shake(document.getElementById('note-content'));
          toast('Écris au moins quelques lignes (100 caractères) pour que l\'IA puisse en tirer des révisions.', 'error');
          return;
        }
        if (window.closeNote) window.closeNote();
        toast('Note enregistrée ✓ L\'IA l\'analyse…', 'success');
        try {
          var r = await RB.data.documents.saveNote(title || 'Note du ' + new Date().toLocaleDateString('fr-FR'), content);
          document.getElementById('note-title').value = '';
          document.getElementById('note-content').value = '';
          RB.celebrate(r.xp);
          toast('Note analysée ✨ Retrouve-la dans Mes documents', 'success');
        } catch (e) { RB.handleError(e); }
      };
    }
  }

  /* ─── Avis des élèves ─────────────────────────────────────────────────
     RelBrain propose à l'élève de donner son avis seulement après une vraie
     utilisation (2 quiz, ou 15 cartes révisées… voir should_ask_review en base).
     L'avis reste en attente jusqu'à sa validation dans la salle des profs,
     puis il apparaît sur la page d'accueil si l'élève l'a accepté.          */
  var REVIEW_SNOOZE_DAYS = 7;          // « Plus tard » : on redemande dans 7 jours
  var REVIEW_DELAY_MS = 20000;         // la fenêtre s'ouvre après 20 s sur la page
  var REVIEW_SKIP = /admin|parametres|quiz-interface|maintenance/;
  RB.review = {
    open: async function () {
      var ctx = shellCtx; if (!ctx) return;
      var p = ctx.profile || {}, mine = null;
      try { mine = (await RB.sb.from('reviews').select('rating,comment,display_name,allow_publish,status').eq('user_id', ctx.user.id).maybeSingle()).data; } catch (e) {}
      var name = mine ? mine.display_name : [p.first_name || (ctx.user.email || '').split('@')[0], p.field || p.institution].filter(Boolean).join(', ');
      var rating = mine ? mine.rating : 0;
      var ov = document.createElement('div');
      ov.className = 'rb-overlay open';
      ov.innerHTML = '<div class="rb-modal" role="dialog" aria-modal="true" aria-labelledby="rv-title" style="max-width:26rem">' +
        '<p class="rb-eyebrow">Ton avis compte</p>' +
        '<h2 id="rv-title" style="font-family:var(--rb-font-display);font-weight:650;font-size:1.45rem;line-height:1.2;margin:.4rem 0 .3rem">Que penses-tu de RelBrain ?</h2>' +
        '<p class="rb-caption" style="margin-bottom:1rem">' + (mine ? 'Tu peux modifier ton avis : il sera relu à nouveau avant publication.' : 'Ton retour nous aide à améliorer RelBrain, et il aide d\'autres élèves à se décider.') + '</p>' +
        '<div id="rv-stars" role="radiogroup" aria-label="Ta note" style="display:flex;gap:.3rem;margin-bottom:1rem">' +
          [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" role="radio" data-n="' + n + '" aria-label="' + n + ' sur 5" style="font-size:2rem;line-height:1;background:none;border:0;cursor:pointer;padding:0 .1rem;transition:transform var(--rb-dur-fast) var(--rb-ease-spring)">★</button>'; }).join('') +
        '</div>' +
        '<div class="rb-field" style="margin-bottom:.75rem"><label class="rb-field-label" for="rv-text">Ton avis</label><textarea class="rb-control" id="rv-text" maxlength="500" rows="4" style="min-height:6rem" placeholder="Ce qui t\'aide, ce qui manque…"></textarea><span class="rb-field-hint" id="rv-count">10 caractères minimum</span></div>' +
        '<div class="rb-field" style="margin-bottom:.75rem"><label class="rb-field-label" for="rv-name">Signé</label><input class="rb-control" id="rv-name" maxlength="60"/><span class="rb-field-hint">Ton prénom et ta classe suffisent, par exemple « Awa, Terminale C ».</span></div>' +
        '<label class="rb-check" style="margin-bottom:1.1rem"><input type="checkbox" id="rv-pub" checked/> J\'accepte que cet avis soit publié sur le site RelBrain.</label>' +
        '<div style="display:flex;gap:.5rem"><button type="button" class="rb-btn rb-btn--ghost rb-btn--sm" style="flex:1" data-later>Plus tard</button><button type="button" class="rb-btn rb-btn--ink rb-btn--sm" style="flex:1.4" data-send>Envoyer mon avis</button></div>' +
      '</div>';
      document.body.appendChild(ov);
      var stars = ov.querySelectorAll('#rv-stars button'), text = ov.querySelector('#rv-text');
      ov.querySelector('#rv-name').value = name || '';
      text.value = mine ? mine.comment : '';
      ov.querySelector('#rv-pub').checked = mine ? mine.allow_publish : true;
      function paint(n) { stars.forEach(function (b, i) { b.style.color = i < n ? 'var(--rb-amber)' : 'var(--rb-line)'; b.setAttribute('aria-checked', i + 1 === rating ? 'true' : 'false'); }); }
      stars.forEach(function (b) {
        b.onclick = function () { rating = +b.dataset.n; paint(rating); b.style.transform = 'scale(1.25)'; setTimeout(function () { b.style.transform = ''; }, 160); };
        b.onmouseenter = function () { paint(+b.dataset.n); };
      });
      ov.querySelector('#rv-stars').onmouseleave = function () { paint(rating); };
      paint(rating);
      text.oninput = function () { var n = text.value.trim().length; ov.querySelector('#rv-count').textContent = n < 10 ? (10 - n) + ' caractère(s) encore' : n + ' / 500'; };
      text.oninput();
      function close() { ov.remove(); }
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      ov.querySelector('[data-later]').onclick = function () {
        try { localStorage.setItem('rb-review-snooze', String(Date.now() + REVIEW_SNOOZE_DAYS * 864e5)); } catch (e) {}
        close();
      };
      ov.querySelector('[data-send]').onclick = async function () {
        var comment = text.value.trim(), who = ov.querySelector('#rv-name').value.trim();
        if (!rating) { if (RB.motion) RB.motion.shake(ov.querySelector('#rv-stars')); return toast('Choisis une note de 1 à 5 étoiles', 'error'); }
        if (comment.length < 10) { if (RB.motion) RB.motion.shake(text); return toast('Écris au moins une phrase (10 caractères)', 'error'); }
        if (who.length < 2) return toast('Indique comment signer ton avis', 'error');
        var btn = this; btn.classList.add('is-loading');
        try {
          var r = await RB.sb.from('reviews').upsert({ user_id: ctx.user.id, rating: rating, comment: comment, display_name: who, allow_publish: ov.querySelector('#rv-pub').checked }, { onConflict: 'user_id' });
          if (r.error) throw r.error;
          if (RB.sound) RB.sound.play('correct');
          if (RB.motion) RB.motion.burst(btn, { set: 'stars' });
          close();
          toast('Merci ! Ton avis sera publié après relecture ✨', 'success');
        } catch (e) { btn.classList.remove('is-loading'); RB.handleError(e); }
      };
    },
    maybeAsk: async function () {
      if (REVIEW_SKIP.test(location.pathname)) return;
      try { if (Number(localStorage.getItem('rb-review-snooze') || 0) > Date.now()) return; } catch (e) {}
      try {
        var r = await RB.sb.rpc('should_ask_review');
        if (r.data === true && !document.querySelector('.rb-overlay.open')) RB.review.open();
      } catch (e) {}
    },
  };

  async function bootShell() {
    var isPrivate = document.body && (document.body.hasAttribute('data-rb-private') || document.querySelector('.sidebar, #sidebar'));
    // Service worker : hors-ligne léger + push
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(function () {});
    if (!isPrivate || RB.demo) { document.documentElement.classList.remove('rb-loading'); return; }

    var session = await RB.auth.require();
    if (!session) return;
    bindActions();
    mountNotificationCenter();
    try {
      var results = await Promise.all([RB.data.profile(), RB.data.gamification()]);
      shellCtx = { user: session.user, profile: results[0], game: results[1] };
      if (window.RB_I18N && results[0]) RB_I18N.syncProfile(results[0].language);
      fill(shellCtx);
    } catch (e) {
      console.warn('[RelBrain] profil indisponible', e);
      var meta = session.user.user_metadata || {};
      shellCtx = { user: session.user, profile: { first_name: meta.first_name, last_name: meta.last_name }, game: {} };
      fill(shellCtx);
    }
    readyCallbacks.splice(0).forEach(function (fn) { try { fn(shellCtx); } catch (e) { console.error(e); } });
    document.dispatchEvent(new CustomEvent('rb:ready', { detail: shellCtx }));

    // Avis : le lien « Donner mon avis » du badge ouvre la fenêtre d'avis ; proposition automatique après usage
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-rb-avis]')) { e.preventDefault(); RB.review.open(); }
    });
    setTimeout(RB.review.maybeAsk, REVIEW_DELAY_MS);

    RB.data.notifications.subscribe(function (n) {
      if (RB.sound) RB.sound.play('notif');
      toast((n.icon ? n.icon + ' ' : '') + n.title, 'info');
      RB.data.gamification().then(function (g) { shellCtx.game = g; fill(shellCtx); });
    });
  }

  RB.refreshShell = async function () {
    if (!shellCtx) return;
    try { shellCtx.game = await RB.data.gamification(); fill(shellCtx); } catch (e) {}
  };

  whenDom(function () { RB.ready.then(bootShell); });
})();
