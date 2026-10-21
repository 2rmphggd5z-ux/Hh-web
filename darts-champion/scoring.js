/* DARTS CHAMPION — scoring.js
 * Pure board geometry, scoring and rules. No DOM access, so it can be unit-tested in Node.
 * Coordinates are normalised: (0,0) is the bull, 1.0 is the outer edge of the double ring,
 * x grows to the right and y grows downwards (same as canvas).
 */
(function (root) {
  'use strict';

  // Clockwise from the top, as on a regulation board.
  var SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  // Regulation radii in millimetres (WDF/PDC), normalised by the 170 mm double-ring edge.
  var MM = { bullIn: 6.35, bullOut: 15.9, trebleIn: 99, trebleOut: 107, doubleIn: 162, doubleOut: 170 };
  var RINGS = {};
  Object.keys(MM).forEach(function (k) { RINGS[k] = MM[k] / MM.doubleOut; });

  function segmentIndexAt(x, y) {
    // Angle measured clockwise from 12 o'clock, in degrees 0..360.
    var deg = Math.atan2(x, -y) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return Math.floor(((deg + 9) % 360) / 18);
  }

  function makeHit(base, mult, ring) {
    var value = base * mult;
    var label;
    if (ring === 'MISS') label = 'Miss';
    else if (ring === 'DB') label = 'Bull';
    else if (ring === 'SB') label = '25';
    else label = (mult === 3 ? 'T' : mult === 2 ? 'D' : '') + base;
    return {
      base: base, mult: mult, value: value, ring: ring, label: label,
      isDouble: ring === 'D' || ring === 'DB',
      isTreble: ring === 'T',
      isBull: ring === 'SB' || ring === 'DB',
      number: ring === 'SB' || ring === 'DB' ? 25 : base
    };
  }

  /** Score for a landing point in normalised board coordinates. */
  function scoreAt(x, y) {
    var r = Math.sqrt(x * x + y * y);
    if (r <= RINGS.bullIn) return makeHit(25, 2, 'DB');
    if (r <= RINGS.bullOut) return makeHit(25, 1, 'SB');
    if (r > RINGS.doubleOut) return makeHit(0, 0, 'MISS');
    var n = SEGMENTS[segmentIndexAt(x, y)];
    if (r >= RINGS.doubleIn) return makeHit(n, 2, 'D');
    if (r >= RINGS.trebleIn && r <= RINGS.trebleOut) return makeHit(n, 3, 'T');
    return makeHit(n, 1, 'S');
  }

  /** Centre point of a named bed: 'T20', 'D16', 'S5', 'SB' (outer bull), 'DB' (bull). */
  function targetPoint(label) {
    if (label === 'DB') return { x: 0, y: 0 };
    if (label === 'SB') return { x: 0, y: -(RINGS.bullIn + RINGS.bullOut) / 2 };
    var kind = label.charAt(0);
    var n = parseInt(label.slice(1), 10);
    var i = SEGMENTS.indexOf(n);
    var r;
    if (kind === 'T') r = (RINGS.trebleIn + RINGS.trebleOut) / 2;
    else if (kind === 'D') r = (RINGS.doubleIn + RINGS.doubleOut) / 2;
    else r = (RINGS.trebleOut + RINGS.doubleIn) / 2; // the big outer single
    var a = i * 18 * Math.PI / 180;
    return { x: r * Math.sin(a), y: -r * Math.cos(a) };
  }

  // ---------- Throw catalogue & checkout routes ----------
  var THROWS = [];
  (function () {
    for (var n = 1; n <= 20; n++) {
      THROWS.push({ label: 'S' + n, show: String(n), value: n, double: false, kind: 0, n: n });
      THROWS.push({ label: 'T' + n, show: 'T' + n, value: 3 * n, double: false, kind: 1, n: n });
      THROWS.push({ label: 'D' + n, show: 'D' + n, value: 2 * n, double: true, kind: 2, n: n });
    }
    THROWS.push({ label: 'SB', show: '25', value: 25, double: false, kind: 3, n: 25 });
    THROWS.push({ label: 'DB', show: 'Bull', value: 50, double: true, kind: 3, n: 25 });
  })();
  var DOUBLES = THROWS.filter(function (t) { return t.double; });

  // Finishing doubles in the order most players prefer to leave them.
  var DOUBLE_PREF = ['D20', 'D16', 'D8', 'D18', 'D12', 'D10', 'D4', 'D14', 'D6', 'D2', 'D19', 'D17',
    'D15', 'D13', 'D11', 'D9', 'D7', 'D5', 'D3', 'D1', 'DB'];

  function setupCost(t) {
    // Lower is better: singles are safest, then trebles, then doubles and bulls.
    var base = [0, 1, 2, 3][t.kind];
    return base + (t.n === 25 ? 0 : (20 - t.n) * 0.01);
  }

  var routeCache = {};

  /** Best checkout routes for `remaining` using at most `dartsLeft` darts (1..3). */
  function checkoutRoutes(remaining, dartsLeft, max) {
    max = max || 2;
    dartsLeft = Math.max(1, Math.min(3, dartsLeft || 3));
    if (remaining < 2 || remaining > 170) return [];
    var key = remaining + ':' + dartsLeft;
    if (!routeCache[key]) {
      var found = [];
      DOUBLES.forEach(function (d) {
        var dc = DOUBLE_PREF.indexOf(d.label) * 0.1;
        if (d.value === remaining) found.push({ darts: [d], cost: 100 + dc });
        if (dartsLeft >= 2) {
          THROWS.forEach(function (a) {
            if (a.value + d.value === remaining) found.push({ darts: [a, d], cost: 200 + dc + setupCost(a) });
          });
        }
        if (dartsLeft >= 3) {
          THROWS.forEach(function (a) {
            if (a.value + d.value >= remaining) return;
            THROWS.forEach(function (b) {
              if (a.value + b.value + d.value === remaining && a.value >= b.value) {
                found.push({ darts: [a, b, d], cost: 300 + dc + setupCost(a) + setupCost(b) * 1.5 });
              }
            });
          });
        }
      });
      found.sort(function (p, q) { return p.cost - q.cost; });
      var seen = {};
      routeCache[key] = found.filter(function (r) {
        var k = r.darts.map(function (t) { return t.label; }).join(' ');
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      }).map(function (r) {
        return { labels: r.darts.map(function (t) { return t.label; }), text: r.darts.map(function (t) { return t.show; }).join(' · ') };
      });
    }
    return routeCache[key].slice(0, max);
  }

  /** Apply one dart in a 501/301 leg (double-out). */
  function x01Dart(remaining, hit) {
    var next = remaining - hit.value;
    if (next < 0 || next === 1) return { result: 'bust', remaining: remaining };
    if (next === 0) return hit.isDouble ? { result: 'win', remaining: 0 } : { result: 'bust', remaining: remaining };
    return { result: 'ok', remaining: next };
  }

  /** Is `remaining` a one-dart double finish (used for checkout percentage)? */
  function onADouble(remaining) {
    return remaining === 50 || (remaining >= 2 && remaining <= 40 && remaining % 2 === 0);
  }

  /** Does a hit count for an Around the Clock / practice target? */
  function hitsTarget(hit, target) {
    // target: {number: 1..20 | 25 | 'any', ring: 'any'|'S'|'D'|'T'|'board'}
    if (hit.ring === 'MISS') return false;
    if (target.ring === 'board') return true;
    if (target.number === 25) {
      if (!hit.isBull) return false;
      return target.ring === 'D' ? hit.ring === 'DB' : true;
    }
    if (target.number !== 'any' && hit.number !== target.number) return false;
    if (target.ring === 'any') return true;
    if (target.ring === 'D') return hit.ring === 'D' || (target.number === 'any' && hit.ring === 'DB');
    return hit.ring === target.ring;
  }

  // ---------- Cricket ----------
  // Numbers 20 down to 15 plus the bull. Three marks close a number; once closed, extra
  // marks score its value while any opponent still has it open. Win by closing everything
  // with at least as many points as every opponent.
  var CRICKET_NUMS = [20, 19, 18, 17, 16, 15, 25];

  function cricketNew(players) {
    var st = { marks: [], points: [] };
    for (var i = 0; i < players; i++) {
      var m = {};
      CRICKET_NUMS.forEach(function (n) { m[n] = 0; });
      st.marks.push(m); st.points.push(0);
    }
    return st;
  }

  function cricketMarksFor(hit) {
    if (hit.ring === 'MISS' || CRICKET_NUMS.indexOf(hit.number) < 0) return 0;
    if (hit.isBull) return hit.ring === 'DB' ? 2 : 1;
    return hit.mult;
  }

  function cricketOpenForOthers(st, pi, n) {
    return st.marks.some(function (m, j) { return j !== pi && m[n] < 3; });
  }

  /** Apply one dart for player `pi`. Mutates `st`. Returns {marks, points, closed}. */
  function cricketDart(st, pi, hit) {
    var m = cricketMarksFor(hit);
    if (!m) return { marks: 0, points: 0, closed: false };
    var n = hit.number, before = st.marks[pi][n];
    var used = Math.min(m, Math.max(0, 3 - before));
    var extra = m - used;
    st.marks[pi][n] = Math.min(3, before + m);
    var pts = extra > 0 && cricketOpenForOthers(st, pi, n) ? extra * n : 0;
    st.points[pi] += pts;
    return { marks: m, points: pts, closed: before < 3 && st.marks[pi][n] >= 3 };
  }

  function cricketAllClosed(st, pi) {
    return CRICKET_NUMS.every(function (n) { return st.marks[pi][n] >= 3; });
  }

  /** Index of the winner, or -1 while the game is still on. */
  function cricketWinner(st) {
    for (var i = 0; i < st.marks.length; i++) {
      if (!cricketAllClosed(st, i)) continue;
      var best = st.points.every(function (p, j) { return j === i || st.points[i] >= p; });
      if (best) return i;
    }
    return -1;
  }

  /** Total marks on the board for a player (tie-breaker after the round limit). */
  function cricketTotalMarks(st, pi) {
    return CRICKET_NUMS.reduce(function (a, n) { return a + st.marks[pi][n]; }, 0);
  }

  var api = {
    SEGMENTS: SEGMENTS, RINGS: RINGS, THROWS: THROWS,
    segmentIndexAt: segmentIndexAt, scoreAt: scoreAt, targetPoint: targetPoint,
    checkoutRoutes: checkoutRoutes, x01Dart: x01Dart, onADouble: onADouble, hitsTarget: hitsTarget,
    CRICKET_NUMS: CRICKET_NUMS, cricketNew: cricketNew, cricketDart: cricketDart, cricketMarksFor: cricketMarksFor,
    cricketAllClosed: cricketAllClosed, cricketWinner: cricketWinner, cricketTotalMarks: cricketTotalMarks,
    cricketOpenForOthers: cricketOpenForOthers
  };
  root.DartsScoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
