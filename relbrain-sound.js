/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — IDENTITÉ SONORE
   Tous les sons sont synthétisés (aucun fichier à télécharger : 0 Mo de
   données mobiles). Ils dérivent d'un même motif, la « synapse » : trois
   notes montantes mi – si – mi, timbre de cloche douce.
     RB.sound.play('correct')   RB.sound.setEnabled(false)   RB.sound.setVolume(.5)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var RB = (window.RB = window.RB || {});
  var E5 = 659.25, G5 = 783.99, B5 = 987.77, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, B6 = 1975.53, A4 = 440, E4 = 329.63, B4 = 493.88;
  var ctx = null, master = null;

  function get(key, fallback) { try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; } }
  function set(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }
  var enabled = get('rb-sound', '1') === '1';
  var volume = Number(get('rb-sound-volume', '0.6'));

  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume * 0.5;
      master.connect(ctx.destination);
    }
    return ctx;
  }
  // Les navigateurs n'autorisent le son qu'après un premier geste de l'élève
  function unlock() { var c = audio(); if (c && c.state === 'suspended') c.resume(); }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, unlock, { passive: true, capture: true }); });

  /** Note de cloche : fondamentale + partiel aigu, attaque nette, extinction douce. */
  function bell(freq, at, dur, gain) {
    var t = ctx.currentTime + at, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    [[1, 'sine', 1], [2.01, 'sine', 0.28], [3.98, 'triangle', 0.07]].forEach(function (p) {
      var o = ctx.createOscillator(), a = ctx.createGain();
      o.type = p[1]; o.frequency.value = freq * p[0]; a.gain.value = p[2];
      o.connect(a); a.connect(g); o.start(t); o.stop(t + dur + 0.05);
    });
  }
  function soft(freq, at, dur, gain, endFreq) {
    var t = ctx.currentTime + at, g = ctx.createGain(), o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  /** Froissement de carte : souffle filtré. */
  function whoosh(at, dur, from, to, gain) {
    var t = ctx.currentTime + at, len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }
  function seq(notes, step, dur, gain) { notes.forEach(function (n, i) { bell(n, i * step, dur, gain); }); }

  var SOUNDS = {
    // Le motif RelBrain, utilisé pour les notifications
    notif: function () { seq([E5, B5, E6], 0.11, 0.7, 0.34); },
    correct: function () { seq([B5, E6], 0.085, 0.4, 0.32); },
    wrong: function () { soft(E4, 0, 0.3, 0.26, 247); soft(B4 / 2, 0.1, 0.32, 0.18, 196); },
    flip: function () { whoosh(0, 0.16, 900, 2600, 0.2); },
    again: function () { soft(B4, 0, 0.2, 0.2, E4); },
    hard: function () { bell(G5, 0, 0.26, 0.24); },
    good: function () { seq([E5, B5], 0.08, 0.32, 0.27); },
    easy: function () { seq([E5, B5, E6], 0.065, 0.36, 0.28); },
    xp: function () { seq([E6, G6], 0.05, 0.22, 0.13); },
    badge: function () { seq([E5, G5, B5, E6, B6], 0.075, 0.55, 0.27); },
    quizGood: function () { seq([E5, G5, B5, E6], 0.1, 0.7, 0.3); },
    quizPerfect: function () { seq([E5, G5, B5, E6, G6, B6], 0.085, 0.8, 0.3); },
    quizLow: function () { seq([E5, B4, E5], 0.14, 0.5, 0.22); },
    levelup: function () {
      seq([E5, B5, E6], 0.11, 0.55, 0.32);
      setTimeout(function () { if (ctx) seq([D6, G6, B6], 0.09, 0.95, 0.28); }, 380);
    },
    ready: function () { seq([A4, E5], 0.09, 0.4, 0.22); },
  };

  RB.sound = {
    play: function (name) {
      if (!enabled || !SOUNDS[name]) return;
      var c = audio();
      if (!c || c.state !== 'running') { if (c) c.resume(); if (!c || c.state !== 'running') return; }
      try { SOUNDS[name](); } catch (e) {}
    },
    enabled: function () { return enabled; },
    setEnabled: function (on) { enabled = !!on; set('rb-sound', on ? '1' : '0'); },
    volume: function () { return volume; },
    setVolume: function (v) { volume = Math.max(0, Math.min(1, Number(v) || 0)); set('rb-sound-volume', String(volume)); if (master) master.gain.value = volume * 0.5; },
    names: Object.keys(SOUNDS),
  };
})();
