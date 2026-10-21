/* DARTS CHAMPION — game.js
 * Game state, modes (501/301, Cricket, Around the Clock, Practice, Daily Challenge), touch throwing,
 * the caller, UI and persistence.
 * Depends on: scoring.js (DartsScoring), ai.js (DartsAI), audio.js (DartsAudio), board.js (DartsBoard),
 * challenges.js (DartsDaily).
 */
(function () {
  'use strict';
  var S = window.DartsScoring, AI = window.DartsAI, A = window.DartsAudio, B = window.DartsBoard, D = window.DartsDaily;
  var $ = function (id) { return document.getElementById(id); };
  var FLIGHT_MS = 360;

  // =====================================================================
  // Persistence
  // =====================================================================
  var STORE_KEY = 'dartsChampion.v1';
  var DEFAULT_SETTINGS = {
    name: 'You', sound: true, volume: 0.8, ambience: false, haptics: true,
    throwLevel: 'standard', sensitivity: 0.65, loupe: true, dart: 'brass', theme: 'classic', aiLevel: 'intermediate',
    caller: true, throwStyle: 'flick'
  };
  var DEFAULT_STATS = {
    matchesPlayed: 0, matchesWon: 0, legsWon: 0, highestVisit: 0, bestCheckout: 0,
    x01Points: 0, x01Darts: 0, checkoutDarts: 0, checkoutHits: 0, total180s: 0, tonPlus: 0,
    totalDarts: 0, practiceThrows: 0, practiceHits: 0, atcBest: 0, atcGames: 0,
    cricketPlayed: 0, cricketWon: 0, cricketMarks: 0, cricketDarts: 0
  };
  var DEFAULT_DAILY = { lastDone: '', streak: 0, best: 0, attemptsDate: '', attempts: 0, doneDates: [] };
  var store = { settings: clone(DEFAULT_SETTINGS), stats: clone(DEFAULT_STATS), daily: clone(DEFAULT_DAILY) };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      Object.keys(DEFAULT_SETTINGS).forEach(function (k) { if (data.settings && k in data.settings) store.settings[k] = data.settings[k]; });
      Object.keys(DEFAULT_STATS).forEach(function (k) { if (data.stats && typeof data.stats[k] === 'number') store.stats[k] = data.stats[k]; });
      Object.keys(DEFAULT_DAILY).forEach(function (k) { if (data.daily && k in data.daily) store.daily[k] = data.daily[k]; });
    } catch (e) { /* storage blocked: play without saving */ }
  }
  function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {} }
  var settings = function () { return store.settings; };
  var stats = function () { return store.stats; };

  // =====================================================================
  // Unlockables
  // =====================================================================
  var UNLOCKS = {
    dart: {
      brass: { need: function () { return true; }, hint: 'Starter set' },
      tungsten: { need: function (s) { return s.matchesWon >= 1; }, hint: 'Win a match' },
      ruby: { need: function (s) { return s.total180s >= 1; }, hint: 'Hit a 180' },
      gold: { need: function (s) { return s.bestCheckout >= 100; }, hint: 'Check out 100+' }
    },
    theme: {
      classic: { name: 'Classic', need: function () { return true; }, hint: 'Pub standard' },
      midnight: { name: 'Midnight', need: function (s) { return s.matchesPlayed >= 3; }, hint: 'Play 3 matches' }
    }
  };
  function unlockedSet() {
    var out = {};
    ['dart', 'theme'].forEach(function (kind) {
      Object.keys(UNLOCKS[kind]).forEach(function (k) { if (UNLOCKS[kind][k].need(stats())) out[kind + ':' + k] = true; });
    });
    return out;
  }
  function unlockName(key) {
    var p = key.split(':');
    return p[0] === 'dart' ? B.DART_STYLES[p[1]].name + ' darts' : UNLOCKS.theme[p[1]].name + ' board';
  }

  // =====================================================================
  // Throw feel
  // =====================================================================
  var THROW_PROFILES = {
    relaxed: { wobble: 0.05, scatter: 0.04, drift: 18, fatigue: 2600, power: 0.12, help: 'A gentle sway. Good for learning the board; trebles still need care.' },
    standard: { wobble: 0.1, scatter: 0.08, drift: 26, fatigue: 1800, power: 0.2, help: 'Your aim drifts and darts scatter like a decent pub player. Release as the sway crosses your target.' },
    pro: { wobble: 0.14, scatter: 0.105, drift: 34, fatigue: 1300, power: 0.28, help: 'Heavy sway, wide scatter, and any movement as you let go pulls the dart. Tournament nerves.' },
    test: { wobble: 0, scatter: 0, drift: 0, fatigue: 99999, power: 0, help: '' }
  };
  function profile() { return THROW_PROFILES[settings().throwLevel] || THROW_PROFILES.standard; }

  // Flick power: an upward flick of about 1.5 px/ms is a perfect throw. Slower drops the dart,
  // faster sends it high. Returns -1.2 (far too hard) .. +1.2 (far too soft).
  var IDEAL_FLICK = 1.5;
  function flickError(speed) {
    var f = Math.log(IDEAL_FLICK / Math.max(0.05, speed)) / Math.log(2);
    return Math.max(-1.2, Math.min(1.2, f));
  }
  function flickLabel(f) { return f > 0.35 ? 'Too soft' : f < -0.35 ? 'Too hard' : 'Good power'; }
  function flickDrop(f, gain, R) { return f * Math.abs(f) * gain * R; } // + is lower on the board

  // =====================================================================
  // Screens, overlays, small UI helpers
  // =====================================================================
  var currentScreen = 'menu';
  var settingsReturn = 'menu';
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + name); });
    currentScreen = name;
    if (name === 'menu') { renderMenuFoot(); renderDailyButton(); menuAnim.start = performance.now(); A.stopCalls(); }
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
    if (name === 'game') requestAnimationFrame(function () { board.resize(); });
  }

  function buzz(pattern) {
    if (!settings().haptics || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }

  var bannerTimer = null;
  function banner(html, kind) {
    var el = $('banner');
    el.className = 'banner';
    void el.offsetWidth;
    el.innerHTML = html;
    el.className = 'banner show' + (kind ? ' ' + kind : '');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { el.className = 'banner'; }, 1650);
  }

  function setHint(text, flash) {
    var el = $('hint');
    el.textContent = text || '';
    if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }

  var confirmResolve = null;
  function askConfirm(title, text, yes) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').querySelector('.btn-title').textContent = yes || 'Yes';
    $('overlay-confirm').hidden = false;
    return new Promise(function (res) { confirmResolve = res; });
  }
  function closeConfirm(answer) {
    $('overlay-confirm').hidden = true;
    if (confirmResolve) { var r = confirmResolve; confirmResolve = null; r(answer); }
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtAvg(points, darts) { return darts ? (points / darts * 3).toFixed(1) : '0.0'; }

  // =====================================================================
  // Board instance
  // =====================================================================
  var board = B.create($('board'));
  var menuBoard = B.create($('menu-board'));
  var menuAnim = { start: 0 };

  // =====================================================================
  // Game state
  // =====================================================================
  var G = null;          // the current game
  var tokenSeq = 0;
  var paused = false;

  function mkPlayer(name, kind, style, level) {
    return {
      name: name, kind: kind, style: style, level: level || null,
      remaining: 0, legs: 0, matchDarts: 0, matchPoints: 0, visitsCount: 0
    };
  }

  function cur() { return G.players[G.current]; }
  function isProfilePlayer(p) { return G && G.players[0] === p; }

  /** Resolves true after `ms` of un-paused time, or false if the game was replaced. */
  function wait(ms) {
    var tok = G && G.token;
    return new Promise(function (res) {
      var left = ms, last = performance.now();
      (function tick() {
        if (!G || G.token !== tok) return res(false);
        var now = performance.now();
        if (!paused) left -= now - last;
        last = now;
        if (left <= 0) return res(true);
        setTimeout(tick, Math.min(40, Math.max(4, left)));
      })();
    });
  }

  function baseGame(config) {
    return {
      config: config, mode: config.mode, token: ++tokenSeq,
      players: [], current: 0, legStarter: 0, legNo: 1,
      visit: null, boardDarts: [], popups: [], flight: null, aim: null, aiAim: null,
      marks: [], log: [], target: null, shake: null, phase: 'idle', unlocks: [], beforeUnlocks: unlockedSet()
    };
  }

  function startGame(config) {
    paused = false;
    $('overlay-pause').hidden = true;
    $('overlay-win').hidden = true;
    closeSheets();
    var st = settings();
    G = baseGame(config);
    if (config.mode === 'x01' || config.mode === 'cricket') {
      var p1 = mkPlayer(st.name || 'You', 'human', st.dart);
      var p2 = config.opponent === 'ai'
        ? mkPlayer(AI.LEVELS[config.aiLevel].name + ' CPU', 'ai', 'ai', config.aiLevel)
        : mkPlayer(config.p2name || 'Player 2', 'human', st.dart === 'tungsten' ? 'brass' : 'p2');
      G.players = [p1, p2];
      G.legStarter = config.first || 0;
      if (config.mode === 'cricket') {
        G.cricket = S.cricketNew(2);
        G.cricketVisits = [0, 0];
        G.current = G.legStarter;
        $('game-title').textContent = 'Cricket' + (config.opponent === 'ai' ? ' v ' + AI.LEVELS[config.aiLevel].name : ' · Local');
      } else {
        G.start = config.start;
        G.legsToWin = config.legs;
        $('game-title').textContent = config.start + (config.opponent === 'ai' ? ' v ' + AI.LEVELS[config.aiLevel].name : ' · Local') + (config.legs > 1 ? ' · Bo' + (config.legs * 2 - 1) : '');
        resetLeg();
      }
    } else if (config.mode === 'daily') {
      var def = D.forDate(D.dateKey());
      G.players = [mkPlayer(st.name || 'You', 'human', st.dart)];
      G.daily = { def: def, used: 0, points: 0, hits: 0, idx: 1 };
      if (def.kind === 'checkout') G.players[0].remaining = def.target;
      G.target = dailyTarget();
      $('game-title').textContent = 'Daily Challenge';
      var dl = store.daily;
      if (dl.attemptsDate !== def.date) { dl.attemptsDate = def.date; dl.attempts = 0; }
      dl.attempts++;
      saveStore();
    } else if (config.mode === 'atc') {
      G.players = [mkPlayer(st.name || 'You', 'human', st.dart)];
      G.atc = { idx: 0, darts: 0, hits: 0 };
      $('game-title').textContent = 'Around the Clock';
      G.target = { number: 1, ring: 'any' };
    } else {
      G.players = [mkPlayer(st.name || 'You', 'human', st.dart)];
      G.prac = { throws: 0, hits: 0, points: 0, dist: { miss: 0, S: 0, D: 0, T: 0, SB: 0, DB: 0 } };
      setPracticeTarget(config.target || 'board', config.custom);
      $('game-title').textContent = 'Practice';
    }
    renderActionBar();
    showScreen('game');
    startVisit();
  }

  function resetLeg() {
    G.players.forEach(function (p) { p.remaining = G.start; });
    G.current = G.legStarter;
    G.boardDarts = [];
    G.log.push({ divider: 'Leg ' + G.legNo });
  }

  // ---------------------------------------------------------------------
  // Visits
  // ---------------------------------------------------------------------
  function startVisit() {
    var p = cur();
    G.visit = { darts: [], startRem: p.remaining, points: 0, bust: false, done: false, player: G.current };
    G.boardDarts = [];
    renderScoreboard(); renderVisit(); renderCheckout();
    if (p.kind === 'ai') {
      G.phase = 'ai';
      setHint(p.name + ' is throwing…');
      aiVisit();
    } else {
      G.phase = 'aim';
      var multi = G.players.length > 1 && G.players.every(function (q) { return q.kind === 'human'; });
      setHint(multi ? p.name + ' to throw' : (settings().throwStyle === 'flick' ? 'Drag to aim · flick up to throw' : 'Touch and drag to aim · lift to throw'));
      if (multi && G.visitCount > 0) banner(esc(p.name) + '<small>to throw</small>');
    }
    if (G.mode === 'x01' && p.remaining <= 170 && S.checkoutRoutes(p.remaining, 3, 1).length) {
      var who = p.kind === 'ai' ? p.name.replace(' CPU', '') + ', you require ' : (p.name === 'You' ? 'You require ' : p.name + ', you require ');
      A.call(who + A.words(p.remaining));
    }
    G.visitCount = (G.visitCount || 0) + 1;
  }

  async function aiVisit() {
    var v = G.visit, tok = G.token, p = cur();
    var lv = AI.LEVELS[p.level];
    if (!(await wait(550))) return;
    while (G && G.token === tok && G.visit === v && !v.done && v.darts.length < 3) {
      var label = G.mode === 'cricket' ? AI.chooseCricketTarget(G.cricket, G.current, p.level) : AI.chooseTarget(p.remaining, 3 - v.darts.length, p.level);
      var land = AI.throwAt(label, p.level);
      var from = G.aiAim ? G.aiAim.to : { x: (Math.random() - 0.5) * 0.4, y: 0.35 };
      G.aiAim = { from: from, to: land.aim, t0: performance.now(), dur: lv.aimTime * 0.65 };
      if (!(await wait(lv.aimTime))) return;
      var aimPx = board.toPx(land.aim.x, land.aim.y);
      G.aiAim = null;
      await throwDart({ x: land.x, y: land.y }, aimPx.x + 30, 'ai');
    }
  }

  /** Shared by human and computer throws. Animates, then applies the rules. */
  async function throwDart(norm, fromX, who) {
    var tok = G.token;
    var p = cur();
    G.phase = 'flight';
    A.play('throw');
    var size = board.size();
    G.flight = { x: norm.x, y: norm.y, fromX: fromX, fromY: size.h + 40, start: performance.now(), dur: FLIGHT_MS, style: p.style };
    if (!(await wait(FLIGHT_MS))) return;
    if (!G || G.token !== tok) return;
    G.flight = null;
    var hit = S.scoreAt(norm.x, norm.y);
    G.boardDarts.push({ x: norm.x, y: norm.y, style: p.style, tilt: (Math.random() - 0.5) * 0.25 });
    var miss = hit.ring === 'MISS';
    A.play('impact', miss);
    if (!miss) { G.shake = { until: performance.now() + 160, power: 3 }; buzz(12); }
    if (isProfilePlayer(p)) { stats().totalDarts++; }

    var outcome;
    if (G.mode === 'x01') outcome = applyX01(hit, p);
    else if (G.mode === 'cricket') outcome = applyCricket(hit, p);
    else if (G.mode === 'atc') outcome = applyATC(hit);
    else if (G.mode === 'daily') outcome = applyDaily(hit, p);
    else outcome = applyPractice(hit, norm);

    renderScoreboard(); renderVisit(); renderCheckout();

    if (outcome === 'continue') {
      if (p.kind === 'human') { G.phase = 'aim'; }
      return;
    }
    G.visit.done = true;
    G.phase = 'between';
    setHint('');
    if (outcome === 'legEnd') await finishLeg();
    else if (outcome === 'atcWin') await finishATC();
    else if (outcome === 'cricketWin') await finishCricket(G.current);
    else if (outcome === 'dailyWin') await finishDaily(true);
    else if (outcome === 'dailyFail') await finishDaily(false);
    else await finishVisit();
  }

  function popup(norm, text, color, big) {
    G.popups.push({ x: norm.x, y: norm.y, text: text, color: color, big: !!big, t0: performance.now(), life: 1000 });
  }
  function hitColor(hit) {
    if (hit.ring === 'MISS') return '#b9b2a0';
    if (hit.isBull) return '#ff8a80';
    if (hit.isTreble) return '#ffcf6e';
    if (hit.isDouble) return '#7fe0a8';
    return '#fff6e2';
  }

  // ---------------------------------------------------------------------
  // 501 / 301
  // ---------------------------------------------------------------------
  function applyX01(hit, p) {
    var v = G.visit, before = p.remaining, profileP = isProfilePlayer(p);
    if (profileP && S.onADouble(before)) stats().checkoutDarts++;
    var res = S.x01Dart(before, hit);
    v.darts.push(hit);
    p.matchDarts++;
    var last = G.boardDarts[G.boardDarts.length - 1];
    if (res.result === 'bust') {
      v.bust = true;
      p.remaining = v.startRem;
      popup(last, hit.label === 'Miss' ? 'MISS' : hit.label, hitColor(hit));
      A.play('bust'); buzz([40, 40, 40]);
      banner('Bust', 'bust');
      return 'visitEnd';
    }
    p.remaining = res.remaining;
    v.points += hit.value;
    popup(last, hit.ring === 'MISS' ? 'MISS' : hit.label + (hit.mult > 1 && !hit.isBull ? '  ' + hit.value : ''), hitColor(hit), hit.isTreble || hit.ring === 'DB');
    if (res.result === 'win') {
      if (profileP) {
        stats().checkoutHits++;
        stats().bestCheckout = Math.max(stats().bestCheckout, v.startRem);
      }
      return 'legEnd';
    }
    return v.darts.length >= 3 ? 'visitEnd' : 'continue';
  }

  function recordVisit(p, v) {
    var pts = v.bust ? 0 : v.points;
    p.matchPoints += pts;
    p.visitsCount++;
    G.log.push({
      who: G.players.indexOf(p), n: p.visitsCount,
      darts: v.darts.map(function (h) { return h.label; }),
      total: pts, left: p.remaining, kind: v.bust ? 'bust' : (p.remaining === 0 ? 'win' : '')
    });
    if (isProfilePlayer(p)) {
      var s = stats();
      s.x01Points += pts;
      s.x01Darts += v.darts.length;
      if (pts > s.highestVisit) s.highestVisit = pts;
      G.bestVisit = Math.max(G.bestVisit || 0, pts);
      if (pts === 180) s.total180s++;
      if (pts >= 100) s.tonPlus++;
      saveStore();
      checkUnlocks();
    }
  }

  async function finishVisit() {
    var p = cur(), v = G.visit;
    if (G.mode === 'x01') {
      recordVisit(p, v);
      if (!v.bust) {
        if (v.points === 180) { banner('One hundred<br>and eighty!'); A.play('cheer', 2.6); buzz([30, 60, 30, 60, 90]); }
        else if (v.points >= 100) { banner(String(v.points) + '<small>ton' + (v.points >= 140 ? ' forty plus' : '') + '</small>'); A.play('score', true); }
        else if (v.points >= 60) A.play('score', false);
      }
      A.call(v.bust || v.points === 0 ? 'No score' : A.words(v.points) + (v.points === 180 ? '!' : ''), v.points === 180 ? { rate: 0.8, pitch: 0.8 } : null);
      renderScoreboard();
    }
    if (G.mode === 'cricket') {
      G.cricketVisits[G.current]++;
      p.visitsCount++;
      G.log.push({ who: G.current, n: p.visitsCount, darts: v.darts.map(function (h) { return h.label; }), total: v.marks || 0, left: G.cricket.points[G.current], kind: '' });
      if (v.marks) A.call(A.words(v.marks) + (v.marks === 1 ? ' mark' : ' marks') + (v.points ? ', ' + A.words(v.points) + ' points' : ''));
      else A.call('No score');
      if (v.marks >= 9) { banner('Nine marks!'); A.play('cheer', 2.2); }
      else if (v.marks >= 5) A.play('score', true);
    }
    if (!(await wait(v.bust || v.points >= 100 || (v.marks || 0) >= 9 ? 1500 : 1000))) return;
    G.boardDarts = [];
    if (G.mode === 'cricket' && G.cricketVisits[0] >= CRICKET_ROUNDS && G.cricketVisits[1] >= CRICKET_ROUNDS) return finishCricket(cricketLeader());
    if (G.mode === 'x01' || G.mode === 'cricket') G.current = (G.current + 1) % G.players.length;
    startVisit();
  }

  async function finishLeg() {
    var p = cur(), v = G.visit;
    recordVisit(p, v);
    p.legs++;
    var matchOver = p.legs >= G.legsToWin;
    banner(matchOver ? 'Game shot<small>and the match</small>' : 'Game shot<small>leg to ' + esc(p.name) + '</small>');
    A.play(matchOver ? 'win' : 'cheer', 2);
    A.call(matchOver ? 'Game shot, and the match!' : 'Game shot, and the leg!', { interrupt: true, rate: 0.85 });
    buzz([60, 40, 120]);
    if (isProfilePlayer(p)) { stats().legsWon++; saveStore(); }
    renderScoreboard();
    if (!(await wait(matchOver ? 1700 : 2200))) return;
    if (matchOver) return endMatch(p);
    G.legNo++;
    G.legStarter = (G.legStarter + 1) % G.players.length;
    resetLeg();
    startVisit();
  }

  function endMatch(winner) {
    var s = stats();
    s.matchesPlayed++;
    var youWon = winner === G.players[0];
    var vsHuman = G.players[1].kind === 'human';
    if (youWon) s.matchesWon++;
    saveStore();
    checkUnlocks();
    G.phase = 'over';
    reportToHhGames(G.bestVisit);
    var lastWin = G.log.filter(function (e) { return e.kind === 'win'; }).pop();
    var title = vsHuman ? winner.name + ' wins' : (youWon ? 'You win' : winner.name + ' wins');
    showWin({
      kicker: G.legsToWin > 1 ? 'Game shot and the match · ' + G.players[0].legs + '–' + G.players[1].legs : 'Game shot and the match',
      title: title,
      stats: [
        [fmtAvg(winner.matchPoints, winner.matchDarts), '3-dart avg'],
        [winner.matchDarts, 'Darts'],
        [lastWin ? lastWin.total : '-', 'Checkout']
      ],
      celebrate: youWon || vsHuman
    });
  }

  /** When played inside the Hh Games site, offer your best visit of the match for its leaderboard. */
  function reportToHhGames(score) {
    if (!(score > 0)) return;
    try { if (window.parent !== window) window.parent.postMessage({ type: 'hh-score', game: 'darts-championship', score: score }, '*'); } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // Around the Clock
  // ---------------------------------------------------------------------
  function atcTarget(idx) { return { number: idx < 20 ? idx + 1 : 25, ring: 'any' }; }
  function applyATC(hit) {
    var a = G.atc, v = G.visit;
    v.darts.push(hit);
    a.darts++;
    var last = G.boardDarts[G.boardDarts.length - 1];
    var good = S.hitsTarget(hit, atcTarget(a.idx));
    if (good) {
      a.hits++;
      v.points++;
      a.idx++;
      popup(last, hit.label, '#7fe0a8', true);
      A.play('score', false);
      if (a.idx >= 21) return 'atcWin';
      G.target = atcTarget(a.idx);
    } else {
      popup(last, hit.ring === 'MISS' ? 'MISS' : hit.label, '#b9b2a0');
    }
    return v.darts.length >= 3 ? 'visitEnd' : 'continue';
  }
  async function finishATC() {
    var a = G.atc, s = stats();
    G.log.push({ who: 0, n: G.log.length + 1, darts: G.visit.darts.map(function (h) { return h.label; }), total: G.visit.points, left: 0, kind: 'win' });
    s.atcGames++;
    var best = !s.atcBest || a.darts < s.atcBest;
    if (best) s.atcBest = a.darts;
    saveStore();
    G.target = null;
    banner('Round the clock!<small>' + a.darts + ' darts</small>');
    A.play('win'); buzz([60, 40, 120]);
    A.call('Game shot!', { interrupt: true });
    if (!(await wait(1600))) return;
    G.phase = 'over';
    showWin({
      kicker: best ? 'New personal best' : 'Around the Clock complete',
      title: a.darts + ' darts',
      stats: [[a.darts, 'Darts'], [Math.round(a.hits / a.darts * 100) + '%', 'Hit rate'], [s.atcBest, 'Best']],
      celebrate: true
    });
  }

  // ---------------------------------------------------------------------
  // Cricket
  // ---------------------------------------------------------------------
  var CRICKET_ROUNDS = 20;
  function applyCricket(hit, p) {
    var v = G.visit, pi = G.current;
    var res = S.cricketDart(G.cricket, pi, hit);
    v.darts.push(hit);
    v.marks = (v.marks || 0) + res.marks;
    v.points += res.points;
    p.matchDarts++;
    if (isProfilePlayer(p)) { stats().cricketMarks += res.marks; stats().cricketDarts++; }
    var last = G.boardDarts[G.boardDarts.length - 1];
    if (res.points) popup(last, '+' + res.points, '#ffcf6e', true);
    else if (res.marks) popup(last, hit.label + (res.closed ? ' closed' : ''), '#7fe0a8', res.closed);
    else popup(last, hit.ring === 'MISS' ? 'MISS' : hit.label, '#b9b2a0');
    if (S.cricketWinner(G.cricket) === pi) return 'cricketWin';
    return v.darts.length >= 3 ? 'visitEnd' : 'continue';
  }
  function cricketLeader() {
    var c = G.cricket;
    if (c.points[0] !== c.points[1]) return c.points[0] > c.points[1] ? 0 : 1;
    var m0 = S.cricketTotalMarks(c, 0), m1 = S.cricketTotalMarks(c, 1);
    return m0 === m1 ? -1 : (m0 > m1 ? 0 : 1);
  }
  async function finishCricket(winnerIdx) {
    var v = G.visit;
    if (v && v.done && winnerIdx === G.current && S.cricketWinner(G.cricket) === winnerIdx) {
      G.cricketVisits[G.current]++;
      cur().visitsCount++;
      G.log.push({ who: G.current, n: cur().visitsCount, darts: v.darts.map(function (h) { return h.label; }), total: v.marks || 0, left: G.cricket.points[G.current], kind: 'win' });
    }
    var s = stats();
    s.cricketPlayed++;
    if (winnerIdx === 0) s.cricketWon++;
    saveStore();
    var draw = winnerIdx < 0, w = draw ? null : G.players[winnerIdx];
    banner(draw ? 'Draw' : 'Game shot');
    A.play(draw ? 'score' : 'win', true);
    A.call(draw ? 'It is a draw' : 'Game shot!', { interrupt: true });
    buzz([60, 40, 120]);
    renderScoreboard();
    if (!(await wait(1700))) return;
    G.phase = 'over';
    var vsHuman = G.players[1].kind === 'human';
    var shown = w || G.players[0];
    showWin({
      kicker: draw ? 'Cricket · ' + CRICKET_ROUNDS + ' rounds played' : 'Cricket · game shot',
      title: draw ? 'Draw' : (w === G.players[0] && !vsHuman ? 'You win' : w.name + ' wins'),
      stats: [
        [G.cricket.points[G.players.indexOf(shown)], 'Points'],
        [(shown.matchDarts ? S.cricketTotalMarks(G.cricket, G.players.indexOf(shown)) / shown.matchDarts * 3 : 0).toFixed(2), 'Marks / round'],
        [G.cricketVisits[G.players.indexOf(shown)], 'Rounds']
      ],
      celebrate: winnerIdx === 0 || (vsHuman && !draw)
    });
  }

  // ---------------------------------------------------------------------
  // Daily challenge
  // ---------------------------------------------------------------------
  function dailyTarget() {
    var d = G.daily, k = d.def.kind;
    if (k === 'doubles') return { number: 'any', ring: 'D' };
    if (k === 'bulls') return { number: 25, ring: 'any' };
    if (k === 'trebles') return { number: d.def.number, ring: 'T' };
    if (k === 'sprint') return d.idx <= d.def.target ? { number: d.idx, ring: 'any' } : null;
    return null;
  }
  function applyDaily(hit, p) {
    var d = G.daily, def = d.def, v = G.visit;
    v.darts.push(hit);
    d.used++;
    var last = G.boardDarts[G.boardDarts.length - 1];
    var good = false, won = false;
    if (def.kind === 'checkout') {
      var res = S.x01Dart(p.remaining, hit);
      if (res.result === 'bust') {
        v.bust = true; p.remaining = v.startRem;
        popup(last, hit.ring === 'MISS' ? 'MISS' : hit.label, hitColor(hit));
        A.play('bust'); banner('Bust', 'bust');
        return d.used >= def.darts ? 'dailyFail' : 'visitEnd';
      }
      p.remaining = res.remaining; v.points += hit.value;
      good = hit.value > 0; won = res.result === 'win';
    } else if (def.kind === 'score') {
      d.points += hit.value; v.points += hit.value;
      good = hit.value >= 40; won = d.points >= def.target;
    } else if (def.kind === 'sprint') {
      good = S.hitsTarget(hit, { number: d.idx, ring: 'any' });
      if (good) { d.idx++; d.hits++; }
      won = d.idx > def.target;
      G.target = dailyTarget();
    } else {
      good = def.kind === 'doubles' ? hit.isDouble : def.kind === 'bulls' ? hit.isBull : (hit.isTreble && hit.base === def.number);
      if (good) d.hits++;
      won = d.hits >= def.target;
    }
    if (good) v.points = def.kind === 'checkout' || def.kind === 'score' ? v.points : v.points + 1;
    popup(last, hit.ring === 'MISS' ? 'MISS' : hit.label, good ? '#7fe0a8' : '#b9b2a0', good && def.kind !== 'score');
    if (good && def.kind !== 'score' && def.kind !== 'checkout') A.play('score', false);
    if (won) return 'dailyWin';
    if (d.used >= def.darts) return 'dailyFail';
    return v.darts.length >= 3 ? 'visitEnd' : 'continue';
  }
  function dailyProgress() {
    var d = G.daily, def = d.def;
    if (def.kind === 'checkout') return G.players[0].remaining + ' left';
    if (def.kind === 'score') return d.points + ' / ' + def.target;
    if (def.kind === 'sprint') return Math.min(d.idx - 1, def.target) + ' / ' + def.target;
    return d.hits + ' / ' + def.target;
  }
  async function finishDaily(success) {
    var d = G.daily, def = d.def, rec = store.daily;
    var firstToday = rec.lastDone !== def.date;
    if (success) {
      rec.streak = D.streakAfterWin(rec, def.date);
      rec.lastDone = def.date;
      rec.best = Math.max(rec.best || 0, rec.streak);
      if (rec.doneDates.indexOf(def.date) < 0) { rec.doneDates.push(def.date); if (rec.doneDates.length > 60) rec.doneDates.shift(); }
    }
    saveStore();
    renderScoreboard();
    banner(success ? 'Challenge<br>complete' : 'Out of darts', success ? '' : 'bust');
    A.play(success ? 'win' : 'bust');
    if (success) A.call('Challenge complete!', { interrupt: true });
    buzz(success ? [60, 40, 120] : [40, 40, 40]);
    if (!(await wait(1600))) return;
    G.phase = 'over';
    var streak = D.currentStreak(rec, def.date);
    showWin({
      kicker: 'Daily challenge · ' + def.title,
      title: success ? (firstToday ? 'Challenge complete' : 'Done again') : 'Not this time',
      stats: [[d.used + '/' + def.darts, 'Darts used'], [dailyProgress(), 'Progress'], [streak, 'Day streak']],
      celebrate: success,
      againLabel: success ? 'Play again' : 'Try again'
    });
  }

  // ---------------------------------------------------------------------
  // Practice
  // ---------------------------------------------------------------------
  var PRACTICE_TARGETS = {
    board: { label: 'Full board', t: { number: 'any', ring: 'board' } },
    bull: { label: 'Bullseye', t: { number: 25, ring: 'any' } },
    t20: { label: 'Treble 20', t: { number: 20, ring: 'T' } },
    doubles: { label: 'Doubles', t: { number: 'any', ring: 'D' } }
  };
  function setPracticeTarget(key, custom) {
    G.prac.key = key;
    if (key === 'custom') {
      G.prac.target = custom;
      var ringName = { any: '', S: 'Single ', D: 'Double ', T: 'Treble ' }[custom.ring];
      G.prac.label = custom.number === 25 ? (custom.ring === 'D' ? 'Inner bull' : 'Bull') : ringName + custom.number;
      G.config.custom = custom;
    } else {
      G.prac.target = PRACTICE_TARGETS[key].t;
      G.prac.label = PRACTICE_TARGETS[key].label;
    }
    G.config.target = key;
    G.target = G.prac.target.ring === 'board' ? null : G.prac.target;
  }
  function applyPractice(hit, norm) {
    var pr = G.prac, v = G.visit;
    v.darts.push(hit);
    v.points += hit.value;
    pr.throws++;
    pr.points += hit.value;
    var key = hit.ring === 'MISS' ? 'miss' : hit.ring;
    pr.dist[key]++;
    var good = S.hitsTarget(hit, pr.target);
    if (good) pr.hits++;
    var s = stats();
    s.practiceThrows++;
    if (good) s.practiceHits++;
    G.marks.push({ x: norm.x, y: norm.y, good: good && pr.target.ring !== 'board' });
    if (G.marks.length > 400) G.marks.shift();
    var last = G.boardDarts[G.boardDarts.length - 1];
    popup(last, hit.ring === 'MISS' ? 'MISS' : hit.label, good && pr.target.ring !== 'board' ? '#7fe0a8' : hitColor(hit), hit.isTreble || hit.ring === 'DB');
    if (v.darts.length >= 3) {
      G.log.push({ who: 0, n: Math.ceil(pr.throws / 3), darts: v.darts.map(function (h) { return h.label; }), total: v.points, left: null, kind: '' });
      saveStore();
      if (v.points === 180) { banner('One hundred<br>and eighty!'); A.play('cheer', 2.4); }
      return 'visitEnd';
    }
    return 'continue';
  }
  function clearPractice() {
    if (!G || G.mode !== 'practice') return;
    G.token = ++tokenSeq; // cancel pending timers
    G.prac.throws = G.prac.hits = G.prac.points = 0;
    Object.keys(G.prac.dist).forEach(function (k) { G.prac.dist[k] = 0; });
    G.marks = []; G.log = []; G.popups = []; G.flight = null;
    saveStore();
    startVisit();
  }

  // =====================================================================
  // Human input: touch / mouse aiming
  // =====================================================================
  var canvas = $('board');
  function wobbleAt(aim, now) {
    var hold = now - aim.t0;
    var pr = profile(), amp = pr.wobble * board.geom.R;
    // Hold on too long and the arm tires: the sway grows.
    if (hold > pr.fatigue) amp *= 1 + Math.min(1.4, (hold - pr.fatigue) / 1600);
    var t = hold + aim.phase;
    return {
      x: amp * (0.62 * Math.sin(t / 420) + 0.3 * Math.sin(t / 173 + 1.3) + 0.08 * Math.sin(t / 31)),
      y: amp * (0.62 * Math.cos(t / 530 + 0.7) + 0.3 * Math.sin(t / 229 + 2.1) + 0.08 * Math.cos(t / 37)),
      amp: amp
    };
  }
  function clampToCanvas(v, max) { return Math.max(6, Math.min(max - 6, v)); }

  canvas.addEventListener('pointerdown', function (e) {
    A.unlock();
    if (!G || paused || G.phase !== 'aim' || cur().kind !== 'human' || G.aim) return;
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var size = board.size();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    G.aim = {
      id: e.pointerId, lastX: x, lastY: y,
      baseX: clampToCanvas(x, size.w), baseY: clampToCanvas(y - Math.min(72, size.h * 0.14), size.h),
      t0: performance.now(), phase: Math.random() * 5000, moved: 0, samples: []
    };
    G.aim.samples.push({ t: G.aim.t0, x: x, y: y, bx: G.aim.baseX, by: G.aim.baseY });
    setHint('');
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!G || !G.aim || e.pointerId !== G.aim.id) return;
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var a = G.aim, sens = settings().sensitivity, size = board.size();
    var dx = x - a.lastX, dy = y - a.lastY;
    a.moved += Math.abs(dx) + Math.abs(dy);
    a.baseX = clampToCanvas(a.baseX + dx * sens, size.w);
    a.baseY = clampToCanvas(a.baseY + dy * sens, size.h);
    a.lastX = x; a.lastY = y;
    var now = performance.now();
    a.samples.push({ t: now, x: x, y: y, bx: a.baseX, by: a.baseY });
    while (a.samples.length > 2 && now - a.samples[0].t > 450) a.samples.shift();
  });

  function releaseAim(e) {
    if (!G || !G.aim || e.pointerId !== G.aim.id) return;
    var a = G.aim, now = performance.now();
    G.aim = null;
    if (paused || G.phase !== 'aim') return;
    var flick = settings().throwStyle === 'flick';
    if (!flick && now - a.t0 < 170 && a.moved < 6) {
      setHint('Hold and drag to aim, then lift your finger to throw', true);
      return;
    }
    var w = wobbleAt(a, now), pr = profile(), R = board.geom.R;
    if (flick) return releaseFlick(a, now, w, pr, R);
    // Release drift: a finger still moving when it lifts drags the dart that way.
    var first = a.samples[0], last = a.samples[a.samples.length - 1];
    var dt = Math.max(16, last.t - first.t);
    var vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
    if (now - last.t > 120) { vx = 0; vy = 0; }
    var dxp = vx * pr.drift * settings().sensitivity, dyp = vy * pr.drift * settings().sensitivity;
    var dm = Math.hypot(dxp, dyp), cap = R * 0.12;
    if (dm > cap) { dxp *= cap / dm; dyp *= cap / dm; }
    var sx = AI.gaussian(Math.random) * pr.scatter * R, sy = AI.gaussian(Math.random) * pr.scatter * R;
    var px = a.baseX + w.x + dxp + sx, py = a.baseY + w.y + dyp + sy;
    G.lastRelease = { aimX: a.baseX + w.x, aimY: a.baseY + w.y, landX: px, landY: py };
    throwDart(board.toNorm(px, py), a.lastX, 'human');
  }
  /** Flick mode: the aim is where the reticle was when the upward flick began; flick speed sets height. */
  function findFlick(samples, now) {
    var end = samples.length - 1;
    if (end < 1 || now - samples[end].t > 120) return null;
    var k = end;
    while (k > 0) {
      var a = samples[k - 1], b = samples[k];
      if (b.t - a.t > 60) break; // the finger paused here, so the flick starts after it
      var vy = (b.y - a.y) / Math.max(1, b.t - a.t);
      if (vy > -0.12) break;
      k--;
    }
    // The aim is taken from the last still moment before the flick, so flicking never moves the aim.
    var still = samples[Math.max(0, k - 1)], s = samples[k], e = samples[end];
    var steps = Math.max(1, end - k);
    var step = end > k ? (e.t - s.t) / steps : 16;
    var dist = still.y - e.y, time = Math.max(16, e.t - s.t + step);
    if (dist < 24) return null;
    return { start: still, speed: dist / time, vx: (e.x - still.x) / time };
  }
  function releaseFlick(a, now, w, pr, R) {
    var f = findFlick(a.samples, now);
    if (!f) { setHint('Aim, then flick your finger up to throw', true); return; }
    var err = flickError(f.speed);
    var wob = wobbleAt(a, f.start.t);
    var aimX = f.start.bx + wob.x, aimY = f.start.by + wob.y;
    var dxp = f.vx * pr.drift * 0.6;
    if (Math.abs(dxp) > R * 0.12) dxp = Math.sign(dxp) * R * 0.12;
    var dyp = flickDrop(err, pr.power, R);
    var sx = AI.gaussian(Math.random) * pr.scatter * R, sy = AI.gaussian(Math.random) * pr.scatter * R;
    var px = aimX + dxp + sx, py = aimY + dyp + sy;
    G.lastRelease = { aimX: aimX, aimY: aimY, landX: px, landY: py, speed: f.speed, err: err };
    G.power = { f: err, label: flickLabel(err), t0: now };
    throwDart(board.toNorm(px, py), a.lastX, 'human');
  }

  canvas.addEventListener('pointerup', releaseAim);
  canvas.addEventListener('pointercancel', function (e) { if (G && G.aim && e.pointerId === G.aim.id) G.aim = null; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

  // =====================================================================
  // Rendering
  // =====================================================================
  function buildScene(now) {
    var reticle = null;
    if (G.aim) {
      var w = wobbleAt(G.aim, now), R = board.geom.R;
      reticle = { x: G.aim.baseX + w.x, y: G.aim.baseY + w.y, radius: Math.max(7, profile().scatter * 1.5 * R), color: '#f6efe0' };
    } else if (G.aiAim) {
      var k = Math.min(1, (now - G.aiAim.t0) / G.aiAim.dur), e = 1 - Math.pow(1 - k, 3);
      var nx = G.aiAim.from.x + (G.aiAim.to.x - G.aiAim.from.x) * e, ny = G.aiAim.from.y + (G.aiAim.to.y - G.aiAim.from.y) * e;
      var p = board.toPx(nx, ny);
      reticle = { x: p.x + Math.sin(now / 300) * 2, y: p.y + Math.cos(now / 380) * 2, radius: 9, color: '#3cc39a' };
    }
    G.popups = G.popups.filter(function (pp) { return now - pp.t0 < pp.life; });
    return {
      darts: G.boardDarts, flight: G.flight, reticle: reticle, popups: G.popups,
      target: G.target, marks: G.mode === 'practice' ? G.marks : null, shake: G.shake,
      loupe: !!G.aim && settings().loupe,
      power: G.power && now - G.power.t0 < 1500 ? G.power : null
    };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (currentScreen === 'game' && G) board.draw(buildScene(now), now);
    else if (currentScreen === 'menu') drawMenuBoard(now);
  }

  function drawMenuBoard(now) {
    var t = now - menuAnim.start;
    if (t > 2200 && menuAnim.drawn) return;
    var land = S.targetPoint('T20');
    var scene = { darts: [], popups: [] };
    if (t > 700 && t < 700 + FLIGHT_MS) {
      scene.flight = { x: land.x + 0.02, y: land.y, fromX: menuBoard.size().w * 0.8, fromY: menuBoard.size().h + 30, start: menuAnim.start + 700, dur: FLIGHT_MS, style: settings().dart };
    } else if (t >= 700 + FLIGHT_MS) {
      scene.darts = [{ x: land.x + 0.02, y: land.y, style: settings().dart, tilt: 0.05 }];
    }
    menuBoard.draw(scene, now);
    menuAnim.drawn = t > 2200;
  }

  function renderScoreboard() {
    var el = $('scoreboard');
    if (!G) return;
    if (G.mode === 'x01') {
      el.innerHTML = G.players.map(function (p, i) {
        var cls = 'pcard ' + (i === 0 ? 'p1' : p.kind === 'ai' ? 'ai' : 'p2') + (i === G.current && G.phase !== 'over' ? ' active' : '');
        var legs = '';
        if (G.legsToWin > 1) { for (var k = 0; k < G.legsToWin; k++) legs += '<i class="' + (k < p.legs ? 'won' : '') + '"></i>'; }
        return '<div class="' + cls + '" id="pcard-' + i + '">' +
          '<div class="pcard-head"><span class="pcard-dot"></span><span class="pcard-name">' + esc(p.name) + '</span><span class="pcard-legs">' + legs + '</span></div>' +
          '<div class="pcard-score">' + p.remaining + '</div>' +
          '<div class="pcard-meta"><span>Avg ' + fmtAvg(p.matchPoints, p.matchDarts) + '</span><span>' + p.matchDarts + ' darts</span></div></div>';
      }).join('');
    } else if (G.mode === 'cricket') {
      var c = G.cricket;
      var head = G.players.map(function (p, i) {
        var cls = 'pcard ' + (i === 0 ? 'p1' : p.kind === 'ai' ? 'ai' : 'p2') + (i === G.current && G.phase !== 'over' ? ' active' : '');
        return '<div class="' + cls + ' ck-head"><div class="pcard-head"><span class="pcard-dot"></span><span class="pcard-name">' + esc(p.name) + '</span></div>' +
          '<div class="ck-points">' + c.points[i] + '</div><div class="pcard-meta"><span>MPR ' + (p.matchDarts ? (S.cricketTotalMarks(c, i) / p.matchDarts * 3).toFixed(2) : '0.00') + '</span><span>R ' + G.cricketVisits[i] + '/' + CRICKET_ROUNDS + '</span></div></div>';
      });
      // Chalkboard: player 1's marks above the numbers, player 2's below.
      var cells = function (pi) {
        return S.CRICKET_NUMS.map(function (n) {
          var dead = c.marks[0][n] >= 3 && c.marks[1][n] >= 3;
          return '<span class="ck-m' + (dead ? ' dead' : '') + '">' + markSvg(c.marks[pi][n]) + '</span>';
        }).join('');
      };
      var nums = S.CRICKET_NUMS.map(function (n) {
        var dead = c.marks[0][n] >= 3 && c.marks[1][n] >= 3;
        return '<span class="ck-n' + (dead ? ' dead' : '') + '">' + (n === 25 ? 'B' : n) + '</span>';
      }).join('');
      var p2cls = G.players[1].kind === 'ai' ? 'ai' : 'p2';
      el.innerHTML = head[0] + head[1] + '<div class="ck-table wide-card" aria-label="Cricket marks">' +
        '<span class="ck-who p1"></span>' + cells(0) + '<span class="ck-who"></span>' + nums + '<span class="ck-who ' + p2cls + '"></span>' + cells(1) + '</div>';
    } else if (G.mode === 'daily') {
      var dd = G.daily, rec = store.daily;
      el.innerHTML = '<div class="pcard wide-card p1 active"><div class="atc-row"><div><div class="atc-label">Daily challenge</div><div class="daily-title">' + esc(dd.def.title) + '</div></div>' +
        '<div class="atc-meta"><b>' + dailyProgress() + '</b>' + (dd.def.darts - dd.used) + ' darts left</div></div>' +
        '<p class="daily-detail">' + esc(dd.def.detail) + '</p>' +
        '<div class="daily-foot"><span>Attempt ' + rec.attempts + ' today</span><span>Day streak ' + D.currentStreak(rec, dd.def.date) + '</span></div></div>';
    } else if (G.mode === 'atc') {
      var a = G.atc, track = '';
      for (var i = 0; i < 21; i++) track += '<span class="' + (i < a.idx ? 'done' : i === a.idx ? 'now' : '') + '">' + (i < 20 ? i + 1 : 'B') + '</span>';
      el.innerHTML = '<div class="pcard wide-card p1 active"><div class="atc-row"><div><div class="atc-label">Target</div><div class="atc-target">' +
        (a.idx < 20 ? a.idx + 1 : a.idx === 20 ? 'Bull' : 'Done') + '</div></div><div class="atc-meta"><b>' + a.darts + '</b>darts · ' +
        (a.darts ? Math.round(a.hits / a.darts * 100) : 0) + '% hits</div></div><div class="atc-track">' + track + '</div></div>';
    } else {
      var pr = G.prac, d = pr.dist, tot = Math.max(1, pr.throws);
      var parts = [['miss', '#5a5547', 'Miss'], ['S', '#e9dcb6', 'Single'], ['D', '#2a9d5c', 'Double'], ['T', '#d9a441', 'Treble'], ['SB', '#3b7f5f', '25'], ['DB', '#d13a33', 'Bull']];
      el.innerHTML = '<div class="pcard wide-card p1 active"><div class="pcard-head"><span class="pcard-dot"></span><span class="pcard-name">Target: ' + esc(pr.label) + '</span></div>' +
        '<div class="prac-grid"><div><b>' + pr.throws + '</b><small>Darts</small></div><div><b>' + pr.hits + '</b><small>Hits</small></div>' +
        '<div><b>' + (pr.throws ? Math.round(pr.hits / pr.throws * 100) : 0) + '%</b><small>Accuracy</small></div>' +
        '<div><b>' + fmtAvg(pr.points, pr.throws) + '</b><small>3-dart avg</small></div></div>' +
        '<div class="dist">' + parts.map(function (q) { return '<span style="width:' + (d[q[0]] / tot * 100) + '%;background:' + q[1] + '"></span>'; }).join('') + '</div>' +
        '<div class="dist-legend">' + parts.map(function (q) { return '<span><i style="background:' + q[1] + '"></i>' + q[2] + ' ' + d[q[0]] + '</span>'; }).join('') + '</div></div>';
    }
  }

  function markSvg(m) {
    if (!m) return '';
    var l1 = '<path d="M5 19L19 5"/>', l2 = '<path d="M5 5l14 14"/>', ring = '<circle cx="12" cy="12" r="10"/>';
    return '<svg class="mk mk' + m + '" viewBox="0 0 24 24" aria-label="' + m + ' mark' + (m > 1 ? 's' : '') + '">' + l1 + (m >= 2 ? l2 : '') + (m >= 3 ? ring : '') + '</svg>';
  }

  function renderVisit() {
    var v = G && G.visit;
    for (var i = 0; i < 3; i++) {
      var slot = $('slot-' + i), h = v && v.darts[i];
      slot.className = 'slot' + (h ? ' filled ' + (h.ring === 'MISS' ? 'm' : h.isBull ? 'b' : h.isTreble ? 't' : h.isDouble ? 'd' : 's') : (v && i === v.darts.length && !v.done ? ' next' : ''));
      slot.querySelector('.slot-label').textContent = h ? h.label : '–';
      slot.querySelector('.slot-val').textContent = h && h.ring !== 'MISS' ? String(h.value) : '';
    }
    var tv = $('visit-total');
    document.querySelector('.vt-label').textContent = G && G.mode === 'cricket' ? 'Marks' : G && G.mode === 'daily' && G.daily.def.kind !== 'checkout' && G.daily.def.kind !== 'score' ? 'Hits' : 'Visit';
    if (!v) { tv.textContent = '0'; return; }
    if (v.bust) tv.textContent = 'BUST';
    else if (G.mode === 'atc') tv.textContent = v.points + '/' + v.darts.length;
    else if (G.mode === 'cricket') tv.textContent = String(v.marks || 0);
    else tv.textContent = String(v.points);
  }

  function renderCheckout() {
    var el = $('checkout');
    var dailyCheckout = G && G.mode === 'daily' && G.daily.def.kind === 'checkout';
    if (!G || (G.mode !== 'x01' && !dailyCheckout) || !G.visit) {
      if (G && G.mode === 'cricket') {
        var cc = G.cricket, me = G.current, open = S.CRICKET_NUMS.filter(function (n) { return cc.marks[me][n] < 3; });
        var scoring = S.CRICKET_NUMS.filter(function (n) { return cc.marks[me][n] >= 3 && cc.marks[1 - me][n] < 3; });
        el.innerHTML = '<span>' + (open.length ? 'Still to close: ' + open.map(function (n) { return n === 25 ? 'Bull' : n; }).join(' ') : 'All closed') + '</span>' +
          (scoring.length ? '<span class="tag">Scoring on ' + scoring.map(function (n) { return n === 25 ? 'Bull' : n; }).join(' ') + '</span>' : '');
        return;
      }
      if (G && G.mode === 'daily') { el.innerHTML = '<span>' + esc(G.daily.def.detail) + '</span>'; return; }
      if (G && G.mode === 'atc') el.innerHTML = '<span>Hit ' + (G.atc.idx < 20 ? 'any ' + (G.atc.idx + 1) + ' (single, double or treble)' : 'the bull (25 or 50)') + '</span>';
      else if (G && G.mode === 'practice') el.innerHTML = '<span>' + (G.prac.target.ring === 'board' ? 'Throw anywhere. Every dart is scored.' : 'Glowing bed counts as a hit.') + '</span>';
      else el.innerHTML = '';
      return;
    }
    var p = cur(), rem = p.remaining, left = 3 - G.visit.darts.length;
    if (dailyCheckout) left = Math.min(left, G.daily.def.darts - G.daily.used);
    if (G.visit.done || left <= 0) { el.innerHTML = ''; return; }
    if (rem > 170) { el.innerHTML = '<span>' + rem + ' to go · checkouts start at 170</span>'; return; }
    var routes = S.checkoutRoutes(rem, left, 2);
    if (routes.length) {
      el.innerHTML = '<span class="tag">Checkout ' + rem + '</span><b>' + routes[0].text + '</b>' + (routes[1] ? '<span class="alt">or ' + routes[1].text + '</span>' : '');
    } else if (S.checkoutRoutes(rem, 3, 1).length) {
      var setup = S.checkoutRoutes(rem, 3, 1)[0];
      el.innerHTML = '<span>' + rem + ': no finish with ' + left + ' dart' + (left > 1 ? 's' : '') + ' · set up with ' + setup.text.split(' · ')[0] + '</span>';
    } else {
      el.innerHTML = '<span>' + rem + ' has no checkout · score to leave a finish</span>';
    }
  }

  function renderActionBar() {
    var el = $('actionbar');
    if (!G) { el.innerHTML = ''; return; }
    if (G.mode === 'practice') {
      var keys = [['board', 'Board'], ['bull', 'Bull'], ['t20', 'T20'], ['doubles', 'Doubles'], ['custom', G.prac.key === 'custom' ? G.prac.label : 'Custom']];
      el.innerHTML = keys.map(function (k) { return '<button class="chip' + (G.prac.key === k[0] ? ' on' : '') + '" data-action="ptarget" data-key="' + k[0] + '">' + esc(k[1]) + '</button>'; }).join('') +
        '<button class="chip ghost" data-action="pclear">Clear board</button>';
    } else if (G.mode === 'atc' || G.mode === 'daily') {
      el.innerHTML = '<button class="chip" data-action="restart">' + (G.mode === 'daily' ? 'Start over' : 'Restart') + '</button>';
    } else {
      el.innerHTML = '';
    }
  }

  function renderHistory() {
    var body = $('history-body');
    if (!G || !G.log.some(function (e) { return !e.divider; })) { body.innerHTML = '<p class="hist-empty">No visits yet. Throw your first three darts.</p>'; return; }
    var html = '';
    if (G.mode === 'cricket') {
      G.players.forEach(function (p, i) {
        html += '<div class="hist-player">' + esc(p.name) + ' · ' + G.cricket.points[i] + ' points</div>';
        G.log.filter(function (e) { return !e.divider && e.who === i; }).slice().reverse().forEach(function (e) {
          html += '<div class="hist-row ' + e.kind + '"><span class="n">' + e.n + '</span><span>' + e.darts.join(' ') + '</span><span class="total">' + e.total + 'M</span><span class="left">' + e.left + ' pts</span></div>';
        });
      });
    } else if (G.mode === 'x01') {
      G.players.forEach(function (p, i) {
        html += '<div class="hist-player">' + esc(p.name) + ' · avg ' + fmtAvg(p.matchPoints, p.matchDarts) + '</div>';
        var rows = G.log.filter(function (e) { return e.divider || e.who === i; }).slice().reverse();
        rows.forEach(function (e) {
          if (e.divider) { if (G.legsToWin > 1) html += '<div class="hist-row"><span class="n"></span><span class="n">' + e.divider + '</span><span></span><span></span></div>'; return; }
          html += '<div class="hist-row ' + e.kind + '"><span class="n">' + e.n + '</span><span>' + e.darts.join(' ') + '</span><span class="total">' + (e.kind === 'bust' ? 'BUST' : e.total) + '</span><span class="left">' + (e.kind === 'win' ? 'out' : e.left) + '</span></div>';
        });
      });
    } else {
      G.log.slice().reverse().forEach(function (e) {
        if (e.divider) return;
        html += '<div class="hist-row ' + e.kind + '"><span class="n">' + e.n + '</span><span>' + e.darts.join(' ') + '</span><span class="total">' + e.total + (G.mode === 'atc' ? ' hit' : '') + '</span><span class="left"></span></div>';
      });
    }
    body.innerHTML = html;
  }

  // =====================================================================
  // Win overlay & confetti
  // =====================================================================
  var confetti = { parts: [], running: false };
  function showWin(o) {
    $('win-kicker').textContent = o.kicker;
    $('win-title').textContent = o.title;
    $('win-stats').innerHTML = o.stats.map(function (s) { return '<div><b>' + esc(s[0]) + '</b><small>' + esc(s[1]) + '</small></div>'; }).join('');
    var un = $('win-unlock');
    if (G.unlocks.length) { un.hidden = false; un.textContent = 'Unlocked: ' + G.unlocks.map(unlockName).join(', ') + '. Choose it in Settings.'; }
    else un.hidden = true;
    document.querySelector('#overlay-win [data-action=again] .btn-title').textContent = o.againLabel || 'Play again';
    $('overlay-win').hidden = false;
    setHint('');
    if (o.celebrate) startConfetti();
  }
  function startConfetti() {
    var c = $('confetti'), ctx = c.getContext('2d');
    var rect = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = rect.width * dpr; c.height = rect.height * dpr;
    var colors = ['#d9a441', '#efe4c8', '#d13a33', '#2a9d5c', '#ffffff'];
    confetti.parts = [];
    for (var i = 0; i < 140; i++) {
      confetti.parts.push({ x: Math.random() * rect.width, y: -20 - Math.random() * rect.height * 0.6, vx: (Math.random() - 0.5) * 1.6, vy: 1.5 + Math.random() * 2.8,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, c: colors[i % colors.length] });
    }
    var start = performance.now();
    confetti.running = true;
    (function step(now) {
      if ($('overlay-win').hidden || now - start > 5200) { ctx.clearRect(0, 0, c.width, c.height); confetti.running = false; return; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      confetti.parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx += Math.sin(now / 400 + p.y / 50) * 0.02;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - (now - start) / 5200);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, Math.abs(Math.cos(p.r * 2)) * p.h + 0.5);
        ctx.restore();
      });
      requestAnimationFrame(step);
    })(start);
  }

  function checkUnlocks() {
    if (!G) return;
    var now = unlockedSet();
    Object.keys(now).forEach(function (k) {
      if (!G.beforeUnlocks[k] && G.unlocks.indexOf(k) < 0) G.unlocks.push(k);
    });
  }

  // =====================================================================
  // Menu, setup, stats, settings
  // =====================================================================
  function renderDailyButton() {
    var today = D.dateKey(), def = D.forDate(today), rec = store.daily;
    var done = rec.lastDone === today, streak = D.currentStreak(rec, today);
    $('daily-sub').textContent = def.title + (done ? ' · done' : '') + (streak ? ' · streak ' + streak : '');
    $('daily-btn').classList.toggle('done', done);
  }
  function renderMenuFoot() {
    var s = stats();
    $('menu-foot').textContent = (settings().name || 'You') + ' · ' + s.matchesPlayed + ' match' + (s.matchesPlayed === 1 ? '' : 'es') +
      ' · ' + s.matchesWon + ' won · 3-dart avg ' + fmtAvg(s.x01Points, s.x01Darts);
  }

  var setupCfg = { mode: 'x01', game: '501', local: false, start: 501, opponent: 'ai', aiLevel: 'intermediate', legs: 1, first: 0, p2name: 'Player 2' };
  var AI_HELP = {
    beginner: 'Misses a lot and aims for big singles. Averages around 25–30.',
    intermediate: 'Goes for treble 20 and follows checkout routes. Averages around 55–60.',
    pro: 'Hits trebles often and plays the right finishes. Averages around 90.'
  };
  function openSetup(kind) {
    setupCfg.aiLevel = settings().aiLevel;
    setupCfg.local = kind === 'local';
    if (kind === 'local') { setupCfg.opponent = 'local'; }
    else { setupCfg.opponent = 'ai'; setupCfg.game = kind; }
    if (kind !== 'local' || !setupCfg.game) setupCfg.game = kind === 'local' ? '501' : kind;
    renderSetup();
    showScreen('setup');
  }
  function renderSetup() {
    setupCfg.mode = setupCfg.game === 'cricket' ? 'cricket' : 'x01';
    if (setupCfg.mode === 'x01') setupCfg.start = +setupCfg.game;
    $('setup-title').textContent = setupCfg.local ? 'Local Multiplayer' : (setupCfg.game === 'cricket' ? 'Cricket' : setupCfg.game + ' Darts');
    $('setup-legs-field').hidden = setupCfg.mode === 'cricket';
    $('setup-cricket-help').hidden = setupCfg.mode !== 'cricket';
    setSeg('setup-start', setupCfg.game);
    setSeg('setup-opponent', setupCfg.opponent);
    setSeg('setup-ai', setupCfg.aiLevel);
    setSeg('setup-legs', setupCfg.legs);
    setSeg('setup-first', setupCfg.first);
    $('setup-ai-field').hidden = setupCfg.opponent !== 'ai';
    $('setup-name-field').hidden = setupCfg.opponent !== 'local';
    $('setup-ai-help').textContent = AI_HELP[setupCfg.aiLevel];
    $('setup-first-p1').textContent = settings().name || 'You';
    $('setup-first-p2').textContent = setupCfg.opponent === 'ai' ? 'Computer' : ($('setup-p2').value.trim() || 'Player 2');
  }
  function setSeg(id, value) {
    document.querySelectorAll('#' + id + ' button').forEach(function (b) { b.classList.toggle('on', b.dataset.value === String(value)); b.setAttribute('aria-pressed', b.dataset.value === String(value)); });
  }
  function bindSeg(id, fn) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) { A.unlock(); fn(b.dataset.value); }
    });
  }
  bindSeg('setup-start', function (v) { setupCfg.game = v; renderSetup(); });
  bindSeg('setup-opponent', function (v) { setupCfg.opponent = v; renderSetup(); });
  bindSeg('setup-ai', function (v) { setupCfg.aiLevel = v; renderSetup(); });
  bindSeg('setup-legs', function (v) { setupCfg.legs = +v; renderSetup(); });
  bindSeg('setup-first', function (v) { setupCfg.first = +v; renderSetup(); });
  $('setup-p2').addEventListener('input', renderSetup);

  function renderStats() {
    var s = stats();
    var co = s.checkoutDarts ? (s.checkoutHits / s.checkoutDarts * 100).toFixed(1) + '%' : '–';
    var items = [
      [s.matchesPlayed, 'Matches played'], [s.matchesWon, 'Matches won'],
      [s.highestVisit, 'Highest visit'], [s.bestCheckout || '–', 'Best checkout'],
      [co, 'Checkout %'], [s.total180s, '180s'],
      [s.tonPlus, '100+ visits'], [s.totalDarts, 'Darts thrown'],
      [s.practiceThrows ? Math.round(s.practiceHits / s.practiceThrows * 100) + '%' : '–', 'Practice accuracy'],
      [s.atcBest || '–', 'Best Around the Clock'],
      [s.cricketDarts ? (s.cricketMarks / s.cricketDarts * 3).toFixed(2) : '–', 'Cricket marks / round'],
      [s.cricketWon + '/' + s.cricketPlayed, 'Cricket won / played'],
      [D.currentStreak(store.daily, D.dateKey()), 'Daily streak'], [store.daily.best || 0, 'Best daily streak']
    ];
    $('stats-body').innerHTML = '<div class="stat-grid"><div class="stat hero"><span class="stat-label">3-dart average</span><span class="stat-val">' + fmtAvg(s.x01Points, s.x01Darts) + '</span></div>' +
      items.map(function (it) { return '<div class="stat"><span class="stat-val">' + it[0] + '</span><span class="stat-label">' + it[1] + '</span></div>'; }).join('') + '</div>' +
      '<p class="stats-note">Statistics follow ' + esc(settings().name || 'you') + ' as player 1 in every mode. Checkout % counts darts thrown while on a finishing double. Saved on this device.</p>';
  }

  function drawSwatch(canvas, style) {
    var dpr = Math.min(2, window.devicePixelRatio || 1), c = canvas.getContext('2d');
    canvas.width = 34 * dpr; canvas.height = 34 * dpr;
    c.scale(dpr, dpr);
    var st = B.DART_STYLES[style];
    c.lineCap = 'round';
    c.strokeStyle = '#bfc5cc'; c.lineWidth = 2; c.beginPath(); c.moveTo(4, 30); c.lineTo(10, 24); c.stroke();
    var g = c.createLinearGradient(8, 18, 20, 26); g.addColorStop(0, st.barrel[1]); g.addColorStop(0.5, st.barrel[0]); g.addColorStop(1, st.barrel[1]);
    c.strokeStyle = g; c.lineWidth = 6; c.beginPath(); c.moveTo(10, 24); c.lineTo(19, 15); c.stroke();
    c.strokeStyle = st.shaft; c.lineWidth = 2.5; c.beginPath(); c.moveTo(19, 15); c.lineTo(24, 10); c.stroke();
    c.fillStyle = st.flight; c.beginPath(); c.moveTo(23, 11); c.lineTo(31, 2); c.lineTo(32, 9); c.closePath(); c.fill();
    c.fillStyle = st.flight2; c.beginPath(); c.moveTo(23, 11); c.lineTo(25, 2); c.lineTo(31, 2); c.closePath(); c.fill();
  }
  function drawThemeSwatch(canvas, key) {
    var dpr = Math.min(2, window.devicePixelRatio || 1), c = canvas.getContext('2d'), th = B.THEMES[key];
    canvas.width = 34 * dpr; canvas.height = 34 * dpr;
    c.scale(dpr, dpr); c.translate(17, 17);
    c.fillStyle = th.surround; c.beginPath(); c.arc(0, 0, 17, 0, Math.PI * 2); c.fill();
    for (var i = 0; i < 20; i++) {
      var a0 = (-99 + i * 18) * Math.PI / 180, a1 = a0 + Math.PI / 10;
      c.fillStyle = i % 2 ? th.cream : th.black; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 13, a0, a1); c.fill();
      c.fillStyle = i % 2 ? th.green : th.red; c.beginPath(); c.arc(0, 0, 13, a0, a1); c.arc(0, 0, 11.5, a1, a0, true); c.fill();
    }
    c.fillStyle = th.red; c.beginPath(); c.arc(0, 0, 2, 0, Math.PI * 2); c.fill();
  }

  function renderSettings() {
    var st = settings(), un = unlockedSet();
    $('set-name').value = st.name;
    setSeg('set-throw', st.throwLevel);
    $('set-throw-help').textContent = profile().help;
    $('set-sens').value = st.sensitivity; $('set-sens-out').textContent = Math.round(st.sensitivity * 100) + '%';
    $('set-volume').value = st.volume; $('set-volume-out').textContent = Math.round(st.volume * 100) + '%';
    $('set-sound').checked = st.sound;
    $('set-ambience').checked = st.ambience;
    $('set-haptics').checked = st.haptics;
    $('set-loupe').checked = st.loupe;
    $('haptic-note').textContent = navigator.vibrate ? '' : '(not supported on this device)';
    setSeg('set-ai', st.aiLevel);
    setSeg('set-style', st.throwStyle);
    $('set-style-help').textContent = st.throwStyle === 'flick' ? 'Drag to aim, then flick your finger up. A smooth flick at the right speed flies true; too soft drops the dart low, too hard sends it high.' : 'Drag to aim and lift your finger to throw. No power to judge.';
    $('set-caller').checked = st.caller;
    $('set-caller').disabled = !A.canCall;
    $('caller-note').textContent = A.canCall ? '' : '(not supported in this browser)';
    $('set-darts').innerHTML = ['brass', 'tungsten', 'ruby', 'gold'].map(function (k) {
      var ok = un['dart:' + k];
      return '<button class="swatch' + (st.dart === k ? ' on' : '') + '" data-dart="' + k + '" aria-disabled="' + !ok + '"><canvas></canvas><span>' + B.DART_STYLES[k].name + '<small>' + (ok ? (st.dart === k ? 'In use' : 'Unlocked') : 'Locked · ' + UNLOCKS.dart[k].hint) + '</small></span></button>';
    }).join('');
    $('set-darts').querySelectorAll('.swatch').forEach(function (b) { drawSwatch(b.querySelector('canvas'), b.dataset.dart); });
    $('set-theme').innerHTML = Object.keys(UNLOCKS.theme).map(function (k) {
      var ok = un['theme:' + k];
      return '<button class="swatch' + (st.theme === k ? ' on' : '') + '" data-theme-key="' + k + '" aria-disabled="' + !ok + '"><canvas></canvas><span>' + UNLOCKS.theme[k].name + '<small>' + (ok ? UNLOCKS.theme[k].hint : 'Locked · ' + UNLOCKS.theme[k].hint) + '</small></span></button>';
    }).join('');
    $('set-theme').querySelectorAll('.swatch').forEach(function (b) { drawThemeSwatch(b.querySelector('canvas'), b.dataset.themeKey); });
  }

  function applyAudioSettings() {
    var st = settings();
    A.setVolume(st.volume);
    A.setMuted(!st.sound);
    A.setAmbience(st.ambience && st.sound);
    A.setCaller(st.caller);
    $('mute-btn').classList.toggle('muted', !st.sound);
    $('mute-btn').setAttribute('aria-label', st.sound ? 'Mute sound' : 'Turn sound on');
  }

  function changeSetting(k, v) { settings()[k] = v; saveStore(); }
  $('set-name').addEventListener('input', function (e) { changeSetting('name', e.target.value.trim().slice(0, 14) || 'You'); });
  bindSeg('set-throw', function (v) { changeSetting('throwLevel', v); renderSettings(); });
  bindSeg('set-style', function (v) { changeSetting('throwStyle', v); renderSettings(); });
  $('set-caller').addEventListener('change', function (e) { A.unlock(); changeSetting('caller', e.target.checked); applyAudioSettings(); if (e.target.checked) A.call('One hundred and eighty!', { rate: 0.8, pitch: 0.8 }); });
  bindSeg('set-ai', function (v) { changeSetting('aiLevel', v); renderSettings(); });
  $('set-sens').addEventListener('input', function (e) { changeSetting('sensitivity', +e.target.value); $('set-sens-out').textContent = Math.round(e.target.value * 100) + '%'; });
  $('set-volume').addEventListener('input', function (e) { changeSetting('volume', +e.target.value); $('set-volume-out').textContent = Math.round(e.target.value * 100) + '%'; applyAudioSettings(); });
  $('set-volume').addEventListener('change', function () { A.unlock(); A.play('impact'); });
  $('set-sound').addEventListener('change', function (e) { A.unlock(); changeSetting('sound', e.target.checked); applyAudioSettings(); });
  $('set-ambience').addEventListener('change', function (e) { A.unlock(); changeSetting('ambience', e.target.checked); applyAudioSettings(); });
  $('set-haptics').addEventListener('change', function (e) { changeSetting('haptics', e.target.checked); buzz(20); });
  $('set-loupe').addEventListener('change', function (e) { changeSetting('loupe', e.target.checked); });
  $('set-darts').addEventListener('click', function (e) {
    var b = e.target.closest('.swatch'); if (!b || b.getAttribute('aria-disabled') === 'true') return;
    changeSetting('dart', b.dataset.dart); renderSettings();
    if (G && G.players[0]) G.players[0].style = b.dataset.dart;
  });
  $('set-theme').addEventListener('click', function (e) {
    var b = e.target.closest('.swatch'); if (!b || b.getAttribute('aria-disabled') === 'true') return;
    changeSetting('theme', b.dataset.themeKey); board.setTheme(b.dataset.themeKey); menuBoard.setTheme(b.dataset.themeKey); menuAnim.drawn = false; renderSettings();
  });

  // =====================================================================
  // Custom practice target sheet
  // =====================================================================
  var customPick = { number: 20, ring: 'T' };
  (function buildNumGrid() {
    var nums = [];
    for (var i = 1; i <= 20; i++) nums.push(i);
    nums.push(25);
    $('target-numbers').innerHTML = nums.map(function (n) { return '<button data-n="' + n + '">' + (n === 25 ? 'Bull' : n) + '</button>'; }).join('');
  })();
  function renderTargetSheet() {
    $('target-numbers').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', +b.dataset.n === customPick.number); });
    setSeg('target-ring', customPick.ring);
    document.querySelector('#target-ring [data-value="T"]').disabled = customPick.number === 25;
    document.querySelector('#target-ring [data-value="S"]').disabled = customPick.number === 25;
  }
  $('target-numbers').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    customPick.number = +b.dataset.n;
    if (customPick.number === 25 && (customPick.ring === 'T' || customPick.ring === 'S')) customPick.ring = 'any';
    renderTargetSheet();
  });
  bindSeg('target-ring', function (v) { customPick.ring = v; renderTargetSheet(); });

  function closeSheets() { $('sheet-history').hidden = true; $('sheet-target').hidden = true; if (G && G.phase !== 'over' && paused && $('overlay-pause').hidden) paused = false; }

  // =====================================================================
  // Actions
  // =====================================================================
  function pauseGame() {
    if (!G || G.phase === 'over') return;
    paused = true;
    A.stopCalls();
    if (G.aim) G.aim = null;
    $('overlay-pause').hidden = false;
  }
  function resumeGame() { paused = false; $('overlay-pause').hidden = true; }
  function goMenu() {
    A.stopCalls();
    if (G) G.token = ++tokenSeq;
    G = null; paused = false;
    $('overlay-pause').hidden = true; $('overlay-win').hidden = true; closeSheets();
    showScreen('menu');
  }

  var actions = {
    quick: function () { startGame({ mode: 'x01', start: 501, opponent: 'ai', aiLevel: settings().aiLevel, legs: 1, first: 0 }); },
    'setup-501': function () { openSetup('501'); },
    'setup-301': function () { openSetup('301'); },
    'setup-local': function () { openSetup('local'); },
    'setup-cricket': function () { openSetup('cricket'); },
    daily: function () { startGame({ mode: 'daily' }); },
    'start-x01': function () {
      setupCfg.p2name = $('setup-p2').value.trim().slice(0, 14) || 'Player 2';
      if (setupCfg.opponent === 'ai') { settings().aiLevel = setupCfg.aiLevel; saveStore(); }
      startGame(clone(setupCfg));
    },
    atc: function () { startGame({ mode: 'atc' }); },
    practice: function () { startGame({ mode: 'practice', target: 'board' }); },
    stats: function () { showScreen('stats'); },
    settings: function () { settingsReturn = currentScreen === 'game' ? 'game' : 'menu'; $('overlay-pause').hidden = true; showScreen('settings'); },
    'settings-back': function () {
      showScreen(settingsReturn);
      if (settingsReturn === 'game' && G) { $('overlay-pause').hidden = false; G.players[0].style = settings().dart; }
    },
    menu: function () { showScreen('menu'); },
    pause: pauseGame,
    resume: resumeGame,
    restart: function () {
      var wasPaused = paused;
      paused = true;
      askConfirm('Restart?', 'This game starts again from the beginning. Scores so far are not saved.', 'Restart').then(function (yes) {
        if (yes && G) startGame(G.config); else paused = wasPaused;
      });
    },
    quit: function () {
      askConfirm('Leave this game?', 'You will go back to the main menu and this game will be lost.', 'Leave').then(function (yes) { if (yes) goMenu(); });
    },
    'quit-now': goMenu,
    again: function () { if (G) startGame(G.config); },
    mute: function () { A.unlock(); changeSetting('sound', !settings().sound); applyAudioSettings(); },
    history: function () { if (!G) return; renderHistory(); $('sheet-history').hidden = false; if (G.phase !== 'over') { paused = true; G.aim = null; } },
    'close-sheet': function () { closeSheets(); },
    ptarget: function (btn) {
      if (!G || G.mode !== 'practice') return;
      if (btn.dataset.key === 'custom') {
        if (G.prac.key === 'custom') customPick = clone(G.prac.target);
        renderTargetSheet(); $('sheet-target').hidden = false; paused = true; G.aim = null; return;
      }
      setPracticeTarget(btn.dataset.key);
      renderActionBar(); renderScoreboard(); renderCheckout();
    },
    'apply-target': function () {
      if (!G || G.mode !== 'practice') return;
      setPracticeTarget('custom', clone(customPick));
      closeSheets(); paused = false;
      renderActionBar(); renderScoreboard(); renderCheckout();
    },
    pclear: function () { clearPractice(); },
    'reset-stats': function () {
      askConfirm('Reset statistics?', 'All saved averages, records and unlocks on this device will be cleared. Settings stay as they are.', 'Reset').then(function (yes) {
        if (!yes) return;
        store.stats = clone(DEFAULT_STATS);
        settings().dart = 'brass'; settings().theme = 'classic';
        board.setTheme('classic'); menuBoard.setTheme('classic');
        saveStore(); renderSettings();
      });
    }
  };

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    A.unlock();
    var fn = actions[btn.dataset.action];
    if (fn) fn(btn);
  });
  $('confirm-yes').addEventListener('click', function () { closeConfirm(true); });
  $('confirm-no').addEventListener('click', function () { closeConfirm(false); });
  document.querySelectorAll('.sheet').forEach(function (s) {
    s.addEventListener('click', function (e) { if (e.target === s) closeSheets(); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('overlay-confirm').hidden) closeConfirm(false);
    else if (!$('sheet-history').hidden || !$('sheet-target').hidden) closeSheets();
    else if (currentScreen === 'game' && G && G.phase !== 'over') { if (paused) resumeGame(); else pauseGame(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && currentScreen === 'game') pauseGame(); });

  // =====================================================================
  // Boot
  // =====================================================================
  loadStore();
  board.setTheme(settings().theme);
  menuBoard.setTheme(settings().theme);
  applyAudioSettings();
  var ro = window.ResizeObserver ? new ResizeObserver(function () { board.resize(); }) : null;
  if (ro) ro.observe($('board-wrap')); else window.addEventListener('resize', function () { board.resize(); });
  var mro = window.ResizeObserver ? new ResizeObserver(function () { menuBoard.resize(); menuAnim.drawn = false; }) : null;
  if (mro) mro.observe($('menu-board')); else window.addEventListener('resize', function () { menuBoard.resize(); });
  board.resize(); menuBoard.resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { board.resize(); menuBoard.resize(); menuAnim.drawn = false; });
  document.addEventListener('pointerdown', function () { A.unlock(); }, { once: true });
  showScreen('menu');
  requestAnimationFrame(frame);

  // Offline support when served over https (e.g. GitHub Pages).
  try {
    if ('serviceWorker' in navigator && location.protocol === 'https:' && window.self === window.top) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  } catch (e) {}

  // Small read-only hook for automated testing.
  window.DartsChampion = { state: function () { return G; }, board: board, stats: stats, settings: settings,
    daily: function () { return store.daily; }, flickError: flickError, findFlick: findFlick };
})();
