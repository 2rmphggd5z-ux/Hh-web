/* DARTS CHAMPION — audio.js
 * All sounds are synthesised with the Web Audio API, so there are no audio files to load.
 * Browsers only allow sound after a tap, so DartsAudio.unlock() is called from the first touch.
 */
(function (root) {
  'use strict';
  var ctx = null, master = null, sfxBus = null, ambBus = null, noiseBuf = null, brownBuf = null;
  var volume = 0.8, muted = false, ambienceWanted = false, ambienceNodes = null, clinkTimer = null;

  function unlock() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      master = ctx.createGain();
      master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      ambBus = ctx.createGain(); ambBus.gain.value = 0.55; ambBus.connect(master);
      noiseBuf = makeNoise(false);
      brownBuf = makeNoise(true);
      applyVolume();
    }
    if (ctx.state === 'suspended') ctx.resume();
    if (ambienceWanted && !ambienceNodes) startAmbience();
  }

  function makeNoise(brown) {
    var len = ctx.sampleRate * (brown ? 4 : 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  function applyVolume() {
    if (!master) return;
    master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
  }

  function noise(dur, filterType, freq, q, gainPeak, attack, dest, freqEnd) {
    var t = ctx.currentTime;
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gainPeak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || sfxBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return g;
  }

  function tone(type, f0, f1, dur, peak, delay, dest) {
    var t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  var sfx = {
    throw: function () { noise(0.26, 'bandpass', 500, 0.9, 0.35, 0.09, null, 2600); },
    impact: function (miss) {
      if (miss) { noise(0.12, 'lowpass', 900, 0.7, 0.5, 0.004); tone('sine', 90, 55, 0.12, 0.35); return; }
      noise(0.07, 'highpass', 2500, 0.7, 0.25, 0.002);
      noise(0.14, 'lowpass', 1400, 0.8, 0.55, 0.003);
      tone('sine', 150, 70, 0.11, 0.55);
    },
    score: function (big) {
      var notes = big ? [523, 659, 784] : [659, 880];
      notes.forEach(function (f, i) { tone('triangle', f, f, 0.22, 0.18, i * 0.07); });
    },
    bust: function () { tone('sawtooth', 240, 90, 0.45, 0.16); tone('square', 120, 60, 0.4, 0.06, 0.02); },
    cheer: function (len) {
      len = len || 2.2;
      noise(len, 'bandpass', 1100, 0.5, 0.32, 0.25);
      noise(len * 0.9, 'bandpass', 2400, 0.8, 0.12, 0.3);
      for (var i = 0; i < 10; i++) tone('triangle', 1800 + Math.random() * 1800, 1500, 0.08, 0.035, 0.1 + Math.random() * len * 0.6);
    },
    win: function () {
      [523, 659, 784, 1047, 784, 1047].forEach(function (f, i) { tone('triangle', f, f, i === 5 ? 0.7 : 0.18, 0.2, i * 0.12); });
      sfx.cheer(3);
    },
    tick: function () { tone('sine', 1300, 1300, 0.04, 0.08); }
  };

  function play(name, arg) {
    if (!ctx || muted || volume <= 0) return;
    try { sfx[name](arg); } catch (e) { /* audio is optional */ }
  }

  function startAmbience() {
    if (!ctx || ambienceNodes) return;
    var src = ctx.createBufferSource(); src.buffer = brownBuf; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.6;
    var g = ctx.createGain(); g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2);
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.17;
    var lfoGain = ctx.createGain(); lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(ambBus);
    src.start(); lfo.start();
    ambienceNodes = { src: src, lfo: lfo, g: g };
    scheduleClink();
  }

  function scheduleClink() {
    clearTimeout(clinkTimer);
    clinkTimer = setTimeout(function () {
      if (!ambienceNodes) return;
      if (!muted) {
        var base = 2400 + Math.random() * 1400;
        tone('sine', base, base, 0.35, 0.025, 0, ambBus);
        tone('sine', base * 1.48, base * 1.48, 0.25, 0.015, 0.06, ambBus);
      }
      scheduleClink();
    }, 4000 + Math.random() * 7000);
  }

  function stopAmbience() {
    clearTimeout(clinkTimer);
    if (!ambienceNodes) return;
    var n = ambienceNodes; ambienceNodes = null;
    try {
      n.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
      setTimeout(function () { try { n.src.stop(); n.lfo.stop(); } catch (e) {} }, 1200);
    } catch (e) {}
  }

  // ---------- Caller (speech synthesis) ----------
  var callerOn = true, voice = null, speechPrimed = false;
  var synth = root.speechSynthesis || null;
  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  /** British number words: 141 -> "one hundred and forty-one". */
  function words(n) {
    n = Math.round(n);
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + words(n % 100) : '');
    return String(n);
  }
  function pickVoice() {
    if (!synth) return null;
    var list = synth.getVoices() || [];
    var gb = list.filter(function (v) { return /en[-_]GB/i.test(v.lang); });
    var male = gb.filter(function (v) { return /male|daniel|arthur|george|oliver|ryan|thomas/i.test(v.name) && !/female/i.test(v.name); });
    return male[0] || gb[0] || list.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
  }
  if (synth && 'onvoiceschanged' in synth) synth.onvoiceschanged = function () { voice = pickVoice(); };
  function primeSpeech() {
    if (!synth || speechPrimed) return;
    speechPrimed = true;
    try { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch (e) {}
  }
  function call(text, opts) {
    if (!synth || !callerOn || muted || volume <= 0 || !text) return;
    try {
      if (opts && opts.interrupt) synth.cancel();
      var u = new SpeechSynthesisUtterance(text);
      voice = voice || pickVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
      u.rate = (opts && opts.rate) || 0.92;
      u.pitch = (opts && opts.pitch) || 0.85;
      u.volume = Math.min(1, volume * 1.1);
      synth.speak(u);
    } catch (e) { /* speech is optional */ }
  }
  function stopCalls() { try { if (synth) synth.cancel(); } catch (e) {} }

  root.DartsAudio = {
    unlock: function () { unlock(); primeSpeech(); },
    play: play,
    call: call,
    stopCalls: stopCalls,
    words: words,
    canCall: !!synth,
    setCaller: function (on) { callerOn = !!on; if (!on) stopCalls(); },
    setVolume: function (v) { volume = Math.max(0, Math.min(1, v)); applyVolume(); },
    setMuted: function (m) { muted = !!m; applyVolume(); },
    setAmbience: function (on) { ambienceWanted = !!on; if (on) startAmbience(); else stopAmbience(); }
  };
})(window);
