/* DARTS CHAMPION — challenges.js
 * The daily challenge: one puzzle per calendar day, the same for everyone on that date.
 * Pure functions (no DOM), so the generator and streak logic can be tested in Node.
 */
(function (root) {
  'use strict';

  function seeded(str) {
    // xmur3 hash -> mulberry32 generator
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    var a = (function () { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; })();
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rand, list) { return list[Math.floor(rand() * list.length)]; }

  // Each kind: how to build it from the day's random numbers.
  var KINDS = {
    checkout: function (r) {
      var n = pick(r, [32, 40, 50, 56, 61, 64, 68, 72, 76, 80, 81, 84, 90, 96, 100]);
      var darts = n <= 50 ? 6 : 9;
      return { kind: 'checkout', target: n, darts: darts, title: 'Check out ' + n, detail: 'Finish ' + n + ' on a double within ' + darts + ' darts. Busts still count against you.' };
    },
    score: function (r) {
      var n = pick(r, [150, 160, 170, 180, 200]);
      return { kind: 'score', target: n, darts: 9, title: 'Score ' + n + ' in 9 darts', detail: 'Three visits. Every dart counts towards the total.' };
    },
    doubles: function (r) {
      var n = pick(r, [2, 3]), darts = n === 2 ? 12 : 18;
      return { kind: 'doubles', target: n, darts: darts, title: 'Hit ' + n + ' doubles', detail: 'Any double or the bull counts. You have ' + darts + ' darts.' };
    },
    bulls: function (r) {
      var n = pick(r, [2, 3]), darts = n === 2 ? 12 : 18;
      return { kind: 'bulls', target: n, darts: darts, title: 'Hit ' + n + ' bulls', detail: 'The 25 or the 50 both count. You have ' + darts + ' darts.' };
    },
    sprint: function (r) {
      var to = pick(r, [6, 8, 10]), darts = to * 2 + 3;
      return { kind: 'sprint', target: to, darts: darts, title: 'Clock sprint 1 to ' + to, detail: 'Hit 1 to ' + to + ' in order within ' + darts + ' darts.' };
    },
    trebles: function (r) {
      var num = pick(r, [20, 19, 18, 17]), n = 2;
      return { kind: 'trebles', number: num, target: n, darts: 15, title: 'Hit ' + n + ' treble ' + num + 's', detail: 'Only treble ' + num + ' counts. You have 15 darts.' };
    }
  };
  var ORDER = ['checkout', 'score', 'doubles', 'sprint', 'checkout', 'bulls', 'trebles', 'score'];

  function forDate(dateKey) {
    var r = seeded('darts-champion:' + dateKey);
    var kind = pick(r, ORDER);
    var def = KINDS[kind](r);
    def.date = dateKey;
    return def;
  }

  function dateKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function addDays(key, n) {
    var p = key.split('-').map(Number);
    return dateKey(new Date(p[0], p[1] - 1, p[2] + n, 12));
  }

  /** Streak after completing the challenge on `today`. */
  function streakAfterWin(rec, today) {
    if (rec.lastDone === today) return rec.streak;
    return rec.lastDone === addDays(today, -1) ? rec.streak + 1 : 1;
  }
  /** Streak to display on `today` (a missed day resets it to 0). */
  function currentStreak(rec, today) {
    return rec.lastDone === today || rec.lastDone === addDays(today, -1) ? rec.streak : 0;
  }

  var api = { forDate: forDate, dateKey: dateKey, addDays: addDays, streakAfterWin: streakAfterWin, currentStreak: currentStreak, KINDS: Object.keys(KINDS) };
  root.DartsDaily = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
