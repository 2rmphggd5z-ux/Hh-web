/* DARTS CHAMPION — ai.js
 * Computer opponent. It chooses a bed to aim at, then "throws" with Gaussian scatter.
 * The landing point is scored by the same DartsScoring.scoreAt used for human darts,
 * so the computer can never break the rules.
 */
(function (root) {
  'use strict';
  var S = root.DartsScoring || (typeof require !== 'undefined' ? require('./scoring.js') : null);

  var LEVELS = {
    beginner:     { name: 'Beginner',     sigma: 0.16, wild: 0.16, wildScale: 1.9, aimTime: 900 },
    intermediate: { name: 'Intermediate', sigma: 0.08, wild: 0.06, wildScale: 1.7, aimTime: 750 },
    pro:          { name: 'Professional', sigma: 0.042, wild: 0.02, wildScale: 1.6, aimTime: 620 }
  };

  function gaussian(rand) {
    var u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Pick the bed to aim at for an X01 leg. Returns a label such as 'T20' or 'D16'. */
  function chooseTarget(remaining, dartsLeft, levelKey) {
    if (levelKey === 'beginner') {
      if (remaining > 60) return 'S20';
      var r0 = S.checkoutRoutes(remaining, dartsLeft, 1)[0] || S.checkoutRoutes(remaining, 3, 1)[0];
      if (!r0) return 'S20';
      // Beginners go for the big single instead of a treble when setting up.
      var lab = r0.labels[0];
      return lab.charAt(0) === 'T' ? 'S' + lab.slice(1) : lab;
    }
    if (remaining > 170) return 'T20';
    var route = S.checkoutRoutes(remaining, dartsLeft, 1)[0];
    if (route) return route.labels[0];
    if (levelKey === 'pro') {
      // No finish this visit: set up a good finish for next time.
      var setup = S.checkoutRoutes(remaining, 3, 1)[0];
      if (setup) return setup.labels[0];
    }
    return remaining > 100 ? 'T20' : (remaining > 60 ? 'T' + Math.min(20, Math.floor((remaining - 40) / 3)) : 'S' + Math.max(1, Math.min(20, remaining - 32)));
  }

  /** Simulate a throw at a bed. Returns the landing point in normalised board coordinates. */
  function throwAt(label, levelKey, rand) {
    rand = rand || Math.random;
    var lv = LEVELS[levelKey] || LEVELS.intermediate;
    var aim = S.targetPoint(label);
    var sigma = lv.sigma * (rand() < lv.wild ? lv.wildScale : 1);
    return { x: aim.x + gaussian(rand) * sigma, y: aim.y + gaussian(rand) * sigma, aim: aim };
  }

  /** Pick a bed in Cricket for player `me` given the shared cricket state. */
  function chooseCricketTarget(st, me, levelKey) {
    var nums = S.CRICKET_NUMS, opp = me === 0 ? 1 : 0;
    var mine = st.marks[me], theirs = st.marks[opp];
    var behind = st.points[me] < st.points[opp];
    var pick = null;
    // 1. Behind on points: score on a number I own that they have not closed.
    if (behind && levelKey !== 'beginner') {
      pick = nums.filter(function (n) { return mine[n] >= 3 && theirs[n] < 3; })[0];
    }
    // 2. Defend: close a number they are already scoring on.
    if (pick == null && levelKey === 'pro') {
      pick = nums.filter(function (n) { return theirs[n] >= 3 && mine[n] < 3; })[0];
    }
    // 3. Otherwise close the highest number still open.
    if (pick == null) pick = nums.filter(function (n) { return mine[n] < 3; })[0];
    // 4. Everything closed but still behind: keep scoring wherever they are open.
    if (pick == null) pick = nums.filter(function (n) { return theirs[n] < 3; })[0];
    if (pick == null) pick = 20;
    if (pick === 25) return 'DB';
    return (levelKey === 'beginner' ? 'S' : 'T') + pick;
  }

  var api = { LEVELS: LEVELS, chooseTarget: chooseTarget, chooseCricketTarget: chooseCricketTarget, throwAt: throwAt, gaussian: gaussian };
  root.DartsAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
