/* DARTS CHAMPION — board.js
 * Canvas rendering: the regulation board (cached once per resize), darts in the board,
 * the dart in flight, the aiming reticle, score pop-ups and the zoom loupe.
 * Everything here is drawing only; game rules live in scoring.js and game.js.
 */
(function (root) {
  'use strict';
  var S = root.DartsScoring;
  var R = S.RINGS;
  var TAU = Math.PI * 2;
  var BOARD_EDGE = 1.25;   // sisal edge, in board radii
  var SURROUND = 1.37;     // catch-ring surround

  var THEMES = {
    classic: { black: '#1d1b18', cream: '#eadcb6', red: '#c4262e', green: '#13804a', surround: '#141414', number: '#f3ead2', wire: '#d9dcdf' },
    midnight: { black: '#16181d', cream: '#d9d2c0', red: '#b8243a', green: '#1b6f8c', surround: '#0d1730', number: '#e8edf6', wire: '#e6d9a8' }
  };

  var DART_STYLES = {
    brass:    { name: 'Club Brass',    barrel: ['#f2d58a', '#a9792b'], flight: '#c9302c', flight2: '#f1e6c8', shaft: '#222' },
    tungsten: { name: 'Tungsten Blue', barrel: ['#d7dde4', '#59636e'], flight: '#2464c8', flight2: '#9fc4ff', shaft: '#111' },
    ruby:     { name: 'Ruby Pro',      barrel: ['#e9e2e2', '#6f5a5a'], flight: '#b3123a', flight2: '#ff9fb4', shaft: '#3b0a14' },
    gold:     { name: 'Champion Gold', barrel: ['#fff1b3', '#b8860b'], flight: '#111111', flight2: '#e8c25a', shaft: '#5c4a12' },
    ai:       { name: 'Computer',      barrel: ['#cfe9e1', '#3e6b60'], flight: '#1f9e78', flight2: '#d9fff1', shaft: '#0f2a24' },
    p2:       { name: 'Player 2',      barrel: ['#dfe6ee', '#55606c'], flight: '#2f6fd6', flight2: '#c7dcff', shaft: '#0f1a2c' }
  };

  function create(canvas) {
    var ctx = canvas.getContext('2d');
    var cache = document.createElement('canvas');
    var cctx = cache.getContext('2d');
    var dpr = 1, W = 0, H = 0;
    var geom = { cx: 0, cy: 0, R: 100 };
    var theme = THEMES.classic;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      dpr = Math.min(root.devicePixelRatio || 1, 2.5);
      canvas.width = cache.width = Math.round(W * dpr);
      canvas.height = cache.height = Math.round(H * dpr);
      var fit = Math.min(W, H * 0.98) / 2;
      geom.R = fit / SURROUND;
      geom.cx = W / 2;
      geom.cy = H / 2;
      renderCache();
    }

    function setTheme(key) { theme = THEMES[key] || THEMES.classic; if (W) renderCache(); }

    function toNorm(px, py) { return { x: (px - geom.cx) / geom.R, y: (py - geom.cy) / geom.R }; }
    function toPx(nx, ny) { return { x: geom.cx + nx * geom.R, y: geom.cy + ny * geom.R }; }

    // ---------- static board ----------
    function wedge(c, r0, r1, a0, a1) {
      c.beginPath();
      c.arc(0, 0, r1, a0, a1);
      c.arc(0, 0, r0, a1, a0, true);
      c.closePath();
    }

    function renderCache() {
      var c = cctx, Rp = geom.R;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);

      // Spotlight on the wall behind the board.
      var spot = c.createRadialGradient(geom.cx, geom.cy - Rp * 0.2, Rp * 0.3, geom.cx, geom.cy, Math.max(W, H) * 0.75);
      spot.addColorStop(0, 'rgba(255,226,170,0.20)');
      spot.addColorStop(0.45, 'rgba(255,210,140,0.06)');
      spot.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = spot; c.fillRect(0, 0, W, H);

      c.save();
      c.translate(geom.cx, geom.cy);

      // Surround with drop shadow.
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = Rp * 0.18; c.shadowOffsetY = Rp * 0.05;
      c.beginPath(); c.arc(0, 0, Rp * SURROUND, 0, TAU);
      var sg = c.createRadialGradient(0, -Rp * 0.4, Rp * 0.2, 0, 0, Rp * SURROUND);
      sg.addColorStop(0, shade(theme.surround, 18)); sg.addColorStop(1, theme.surround);
      c.fillStyle = sg; c.fill();
      c.restore();
      c.beginPath(); c.arc(0, 0, Rp * SURROUND - 1, 0, TAU);
      c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 2; c.stroke();

      // Sisal disc (black outer area holding the number ring).
      c.beginPath(); c.arc(0, 0, Rp * BOARD_EDGE, 0, TAU);
      c.fillStyle = '#0f0f0f'; c.fill();

      // Scoring beds.
      for (var i = 0; i < 20; i++) {
        var mid = (-90 + i * 18) * Math.PI / 180;
        var a0 = mid - 9 * Math.PI / 180, a1 = mid + 9 * Math.PI / 180;
        var even = i % 2 === 0;
        var single = even ? theme.black : theme.cream;
        var ring = even ? theme.red : theme.green;
        c.fillStyle = single;
        wedge(c, Rp * R.bullOut, Rp * R.trebleIn, a0, a1); c.fill();
        wedge(c, Rp * R.trebleOut, Rp * R.doubleIn, a0, a1); c.fill();
        c.fillStyle = ring;
        wedge(c, Rp * R.trebleIn, Rp * R.trebleOut, a0, a1); c.fill();
        wedge(c, Rp * R.doubleIn, Rp * R.doubleOut, a0, a1); c.fill();
      }
      c.beginPath(); c.arc(0, 0, Rp * R.bullOut, 0, TAU); c.fillStyle = theme.green; c.fill();
      c.beginPath(); c.arc(0, 0, Rp * R.bullIn, 0, TAU); c.fillStyle = theme.red; c.fill();

      // Sisal fibre texture: end-grain speckle, seeded so it never shimmers.
      var seed = 7;
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      c.save();
      c.beginPath(); c.arc(0, 0, Rp * BOARD_EDGE, 0, TAU); c.clip();
      var dots = Math.round(Rp * Rp * 0.42);
      for (var k = 0; k < dots; k++) {
        var rr = Math.sqrt(rnd()) * Rp * BOARD_EDGE, aa = rnd() * TAU;
        c.fillStyle = rnd() < 0.55 ? 'rgba(0,0,0,0.16)' : 'rgba(255,248,230,0.07)';
        var sz = 0.4 + rnd() * 0.9;
        c.fillRect(Math.cos(aa) * rr, Math.sin(aa) * rr, sz, sz);
      }
      // Soft lighting from the top-left lamp, darker towards the edge.
      var lg = c.createRadialGradient(-Rp * 0.35, -Rp * 0.45, Rp * 0.05, 0, 0, Rp * BOARD_EDGE);
      lg.addColorStop(0, 'rgba(255,245,220,0.16)');
      lg.addColorStop(0.6, 'rgba(255,245,220,0.02)');
      lg.addColorStop(1, 'rgba(0,0,0,0.38)');
      c.fillStyle = lg; c.fillRect(-Rp * 1.3, -Rp * 1.3, Rp * 2.6, Rp * 2.6);
      c.restore();

      // Wire spider: dark shadow line under a bright wire for a raised look.
      var lw = Math.max(1, Rp * 0.0065);
      function wires(offset, color, width) {
        c.strokeStyle = color; c.lineWidth = width;
        [R.bullIn, R.bullOut, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut].forEach(function (r) {
          c.beginPath(); c.arc(offset, offset, Rp * r, 0, TAU); c.stroke();
        });
        for (var j = 0; j < 20; j++) {
          var a = (-90 - 9 + j * 18) * Math.PI / 180;
          c.beginPath();
          c.moveTo(offset + Math.cos(a) * Rp * R.bullOut, offset + Math.sin(a) * Rp * R.bullOut);
          c.lineTo(offset + Math.cos(a) * Rp * (R.doubleOut + 0.035), offset + Math.sin(a) * Rp * (R.doubleOut + 0.035));
          c.stroke();
        }
      }
      wires(lw * 0.9, 'rgba(0,0,0,0.55)', lw * 1.2);
      wires(0, theme.wire, lw);
      // Highlight glint on the wires.
      c.save(); c.globalAlpha = 0.5;
      c.beginPath(); c.arc(0, 0, Rp * R.doubleOut, Math.PI * 1.1, Math.PI * 1.45);
      c.strokeStyle = '#ffffff'; c.lineWidth = lw * 0.6; c.stroke();
      c.restore();

      // Number ring.
      c.beginPath(); c.arc(0, 0, Rp * 1.045, 0, TAU);
      c.strokeStyle = theme.wire; c.globalAlpha = 0.55; c.lineWidth = lw * 0.8; c.stroke(); c.globalAlpha = 1;
      c.fillStyle = theme.number;
      c.font = '700 ' + Math.round(Rp * 0.135) + 'px "Big Shoulders Display", "Arial Narrow", Arial, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      S.SEGMENTS.forEach(function (n, idx) {
        var a = (-90 + idx * 18) * Math.PI / 180;
        c.save();
        c.translate(Math.cos(a) * Rp * 1.15, Math.sin(a) * Rp * 1.15);
        c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 3;
        c.fillText(String(n), 0, 1);
        c.restore();
      });
      c.restore();
    }

    function shade(hex, amt) {
      var n = parseInt(hex.slice(1), 16);
      var r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    // ---------- target highlight ----------
    function targetPath(c, t) {
      var Rp = geom.R;
      c.beginPath();
      if (!t || t.ring === 'board') return false;
      if (t.number === 25) { c.arc(0, 0, Rp * (t.ring === 'D' ? R.bullIn : R.bullOut), 0, TAU); return true; }
      var idxs = t.number === 'any' ? S.SEGMENTS.map(function (_, i) { return i; }) : [S.SEGMENTS.indexOf(t.number)];
      idxs.forEach(function (i) {
        var mid = (-90 + i * 18) * Math.PI / 180, a0 = mid - 9 * Math.PI / 180, a1 = mid + 9 * Math.PI / 180;
        var bands = t.ring === 'D' ? [[R.doubleIn, R.doubleOut]]
          : t.ring === 'T' ? [[R.trebleIn, R.trebleOut]]
          : t.ring === 'S' ? [[R.bullOut, R.trebleIn], [R.trebleOut, R.doubleIn]]
          : [[R.bullOut, R.doubleOut]];
        bands.forEach(function (b) {
          c.moveTo(Math.cos(a0) * Rp * b[1], Math.sin(a0) * Rp * b[1]);
          c.arc(0, 0, Rp * b[1], a0, a1);
          c.arc(0, 0, Rp * b[0], a1, a0, true);
          c.closePath();
        });
      });
      if (t.number === 'any' && t.ring === 'D') {
        c.moveTo(Rp * R.bullIn, 0); c.arc(0, 0, Rp * R.bullIn, 0, TAU);
      }
      return true;
    }

    // ---------- darts ----------
    function drawDart(c, x, y, style, scale, tilt, alpha) {
      var u = geom.R * 0.078 * scale;
      var st = DART_STYLES[style] || DART_STYLES.brass;
      var ang = 0.22 + (tilt || 0);
      var dx = Math.sin(ang) * u * 2.2, dy = Math.cos(ang) * u * 2.2;
      c.save();
      c.globalAlpha = alpha == null ? 1 : alpha;
      // shadow on the board
      if (scale <= 1.05) {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath(); c.ellipse(x + dx * 0.9 + u * 0.5, y + dy * 0.75 + u * 0.3, u * 0.9, u * 0.35, 0.5, 0, TAU); c.fill();
      }
      c.lineCap = 'round';
      // point
      c.strokeStyle = '#bfc5cc'; c.lineWidth = Math.max(1, u * 0.12);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx * 0.28, y + dy * 0.28); c.stroke();
      // barrel
      var g = c.createLinearGradient(x - u * 0.3, y, x + u * 0.3, y);
      g.addColorStop(0, st.barrel[1]); g.addColorStop(0.45, st.barrel[0]); g.addColorStop(1, st.barrel[1]);
      c.strokeStyle = g; c.lineWidth = u * 0.44;
      c.beginPath(); c.moveTo(x + dx * 0.28, y + dy * 0.28); c.lineTo(x + dx * 0.72, y + dy * 0.72); c.stroke();
      // knurling
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = Math.max(0.5, u * 0.05);
      for (var k = 0.36; k < 0.7; k += 0.08) {
        c.beginPath();
        c.moveTo(x + dx * k - dy * 0.1, y + dy * k + dx * 0.1);
        c.lineTo(x + dx * k + dy * 0.1, y + dy * k - dx * 0.1);
        c.stroke();
      }
      // shaft
      c.strokeStyle = st.shaft; c.lineWidth = u * 0.18;
      c.beginPath(); c.moveTo(x + dx * 0.72, y + dy * 0.72); c.lineTo(x + dx * 1.02, y + dy * 1.02); c.stroke();
      // flights, seen from slightly behind: four vanes
      var ex = x + dx * 1.02, ey = y + dy * 1.02;
      for (var v = 0; v < 4; v++) {
        var va = Math.PI / 4 + v * Math.PI / 2 + (tilt || 0) * 0.5;
        var vx = Math.cos(va) * u * 0.95, vy = Math.sin(va) * u * 0.6;
        c.beginPath();
        c.moveTo(ex - dx * 0.12, ey - dy * 0.12);
        c.lineTo(ex + vx * 0.7 - dx * 0.02, ey + vy * 0.7 - dy * 0.02);
        c.lineTo(ex + vx + dx * 0.22, ey + vy + dy * 0.22);
        c.lineTo(ex + dx * 0.24, ey + dy * 0.24);
        c.closePath();
        c.fillStyle = v % 2 ? st.flight : st.flight2;
        c.globalAlpha = (alpha == null ? 1 : alpha) * 0.93;
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = Math.max(0.5, u * 0.04); c.stroke();
      }
      c.restore();
    }

    function drawReticle(c, x, y, radius, color, t) {
      c.save();
      c.strokeStyle = 'rgba(0,0,0,0.65)'; c.lineWidth = 3.5;
      c.beginPath(); c.arc(x, y, radius, 0, TAU); c.stroke();
      c.strokeStyle = color; c.lineWidth = 1.6;
      c.beginPath(); c.arc(x, y, radius, 0, TAU); c.stroke();
      var arm = Math.max(10, radius + 7);
      c.beginPath();
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
        c.moveTo(x + d[0] * (radius * 0.45 + 2), y + d[1] * (radius * 0.45 + 2));
        c.lineTo(x + d[0] * arm, y + d[1] * arm);
      });
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3; c.stroke();
      c.strokeStyle = color; c.lineWidth = 1.4; c.stroke();
      c.fillStyle = color;
      c.beginPath(); c.arc(x, y, 1.6, 0, TAU); c.fill();
      c.restore();
    }

    // ---------- frame ----------
    function draw(scene, now) {
      var c = ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      var sx = 0, sy = 0;
      if (scene.shake && scene.shake.until > now) {
        var k = (scene.shake.until - now) / 160 * scene.shake.power;
        sx = (Math.random() - 0.5) * k; sy = (Math.random() - 0.5) * k;
      }
      c.save();
      c.translate(sx, sy);
      c.drawImage(cache, 0, 0, W, H);

      // target highlight
      if (scene.target) {
        c.save(); c.translate(geom.cx, geom.cy);
        if (targetPath(c, scene.target)) {
          var pulse = 0.5 + 0.5 * Math.sin(now / 260);
          c.fillStyle = 'rgba(255,214,102,' + (0.16 + pulse * 0.16) + ')';
          c.fill('evenodd');
          c.strokeStyle = 'rgba(255,224,140,' + (0.55 + pulse * 0.4) + ')';
          c.lineWidth = 2; c.stroke();
        }
        c.restore();
      }

      // practice marks
      if (scene.marks) {
        scene.marks.forEach(function (m) {
          var p = toPx(m.x, m.y);
          c.fillStyle = m.good ? 'rgba(120,255,170,0.75)' : 'rgba(255,255,255,0.55)';
          c.beginPath(); c.arc(p.x, p.y, 1.8, 0, TAU); c.fill();
        });
      }

      // darts in the board (sorted so lower darts overlap higher ones)
      (scene.darts || []).slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (d) {
        var p = toPx(d.x, d.y);
        drawDart(c, p.x, p.y, d.style, 1, d.tilt || 0, d.faded ? 0.45 : 1);
      });

      // dart in flight
      var f = scene.flight;
      if (f) {
        var t = Math.min(1, (now - f.start) / f.dur);
        var e = 1 - Math.pow(1 - t, 2.2);
        var end = toPx(f.x, f.y);
        var sxp = f.fromX, syp = f.fromY;
        var x = sxp + (end.x - sxp) * e;
        var y = syp + (end.y - syp) * e - Math.sin(Math.PI * t) * geom.R * 0.35;
        var scale = 3.4 - 2.4 * e;
        var wob = Math.sin(t * 34) * (1 - t) * 0.35;
        drawDart(c, x, y, f.style, scale, wob, 1);
      }

      // reticle
      var r = scene.reticle;
      if (r) drawReticle(c, r.x, r.y, r.radius, r.color || '#f6efe0', now);

      // score pop-ups
      (scene.popups || []).forEach(function (p) {
        var age = (now - p.t0) / p.life;
        if (age < 0 || age > 1) return;
        var pp = toPx(p.x, p.y);
        var rise = 26 * age + 10;
        var sc = age < 0.15 ? 0.6 + age / 0.15 * 0.5 : 1.1 - Math.min(0.1, (age - 0.15));
        c.save();
        c.globalAlpha = age > 0.7 ? (1 - age) / 0.3 : 1;
        c.translate(pp.x, pp.y - rise);
        c.scale(sc, sc);
        c.font = '800 ' + (p.big ? 30 : 22) + 'px "Big Shoulders Display", "Arial Narrow", Arial, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.strokeText(p.text, 0, 0);
        c.fillStyle = p.color || '#fff'; c.fillText(p.text, 0, 0);
        c.restore();
      });
      c.restore();

      // flick power read-out after a throw: a gauge at the right edge, sweet spot in the middle
      if (scene.power) {
        var pw = scene.power, age = (now - pw.t0) / 1500;
        var gx = W - 16, gh = Math.min(geom.R * 1.3, H * 0.5), gy = geom.cy - gh / 2;
        c.save();
        c.globalAlpha = age > 0.75 ? (1 - age) / 0.25 : 1;
        var gg = c.createLinearGradient(0, gy, 0, gy + gh);
        gg.addColorStop(0, '#d13a33'); gg.addColorStop(0.32, '#d9a441'); gg.addColorStop(0.42, '#2a9d5c');
        gg.addColorStop(0.58, '#2a9d5c'); gg.addColorStop(0.68, '#d9a441'); gg.addColorStop(1, '#d13a33');
        c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(gx - 6, gy - 4, 12, gh + 8);
        c.fillStyle = gg; c.fillRect(gx - 3, gy, 6, gh);
        // f < 0 is too hard (top), f > 0 too soft (bottom)
        var my = gy + gh / 2 + (pw.f / 1.2) * gh / 2;
        c.fillStyle = '#fff6e2'; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(gx - 9, my); c.lineTo(gx - 17, my - 6); c.lineTo(gx - 17, my + 6); c.closePath(); c.stroke(); c.fill();
        c.font = '700 12px "Barlow Semi Condensed", Arial, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
        c.lineWidth = 4; c.strokeText(pw.label, gx - 21, my); c.fillText(pw.label, gx - 21, my);
        c.restore();
      }

      // zoom loupe while aiming
      if (scene.loupe && r) {
        var Lr = Math.min(geom.R * 0.42, 64), zoom = 2.6;
        var lx = r.x < W / 2 ? W - Lr - 10 : Lr + 10, ly = Lr + 10;
        c.save();
        c.beginPath(); c.arc(lx, ly, Lr, 0, TAU); c.closePath();
        c.fillStyle = '#000'; c.fill();
        c.clip();
        var src = Lr / zoom;
        c.drawImage(canvas, (r.x - src) * dpr, (r.y - src) * dpr, src * 2 * dpr, src * 2 * dpr, lx - Lr, ly - Lr, Lr * 2, Lr * 2);
        c.restore();
        c.save();
        c.beginPath(); c.arc(lx, ly, Lr, 0, TAU);
        c.lineWidth = 3; c.strokeStyle = '#d9a441'; c.stroke();
        c.restore();
      }
    }

    return { resize: resize, draw: draw, toNorm: toNorm, toPx: toPx, geom: geom, setTheme: setTheme,
      size: function () { return { w: W, h: H }; } };
  }

  root.DartsBoard = { create: create, THEMES: THEMES, DART_STYLES: DART_STYLES };
})(window);
