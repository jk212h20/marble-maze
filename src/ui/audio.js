//  All sound is synthesised at runtime — no audio files.
//
//  Impacts are still *contact*: every one-shot below is built from two primitives,
//
//    click()  — a few milliseconds of noise: the tick the instant two hard things touch.
//    struck() — a set of decaying partials: the body of the sound (hollow board, brass cup).
//
//  The roll is no longer modelled. Instead the marble drives a short **song that loops
//  forever**: a fixed step pattern whose *tempo* rises with the ball's speed (never below
//  SONG.minBpm, so a parked marble still keeps time), and whose *timbre* is chosen by the
//  ground under it — wood, ice, sand and steel each voice the same notes differently.
//
//  The loop is scheduled with a small look-ahead window rather than fired from the render
//  loop, so the rhythm stays steady when frame times wobble. Notes are cheap one-shots into
//  a song bus, so pausing or resetting fades the whole tune out with a single gain.
//
//  Fullness comes from three places, all of them behind the notes rather than in them: a
//  quiet held root-and-fifth pad, a short plate reverb on the song bus, and two slightly
//  detuned oscillators on every note. Without those the same pattern is a bare square wave
//  and reads as a chiptune.

export function createAudio() {
  let ctx = null;
  let master = null;
  let comp = null;
  let noiseBuf = null;
  let clickBuf = null;

  // Continuous layers.
  let songGain = null;
  let padGain = null;
  let padFilter = null;
  let padPan = null;
  let songNextT = 0;
  let songStep = 0;
  let songSurface = 'wood';
  let slideSrc = null;
  let slideFilter = null;
  let slideGain = null;
  let slidePan = null;
  let windSrc = null;
  let windFilter = null;
  let windGain = null;
  let windPan = null;
  let humA = null;
  let humB = null;
  let humGain = null;
  let humPan = null;

  let enabled = true;
  let started = false;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const now = () => (ctx ? ctx.currentTime : 0);

  // ---------------------------------------------------------------- buffers

  function makeNoise(seconds = 2) {
    // Pink-ish noise. Cheaper than true pink and it reads as "wood/friction" rather
    // than the thin hiss of white noise.
    const len = Math.max(8, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029;
      b1 = 0.985 * b1 + w * 0.06;
      b2 = 0.95 * b2 + w * 0.12;
      d[i] = clamp(b0 + b1 + b2, -1, 1) * 0.6;
    }
    return buf;
  }

  function makeImpulse(seconds = 1.3, decay = 2.8) {
    // A short plate: decaying noise is a poor "real" reverb but a very good glue. Its job
    // here is to let one note hang in the air under the next, which is most of the distance
    // between a dry pattern and a full-sounding one.
    const len = Math.max(8, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function makeClick(seconds = 0.06, tau = 0.0035) {
    // A contact transient: noise that dies in a few milliseconds.
    const len = Math.max(8, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const k = 1 / (ctx.sampleRate * tau);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i * k);
    return buf;
  }

  // ---------------------------------------------------------------- plumbing

  function makePan() {
    if (ctx.createStereoPanner) return ctx.createStereoPanner();
    const g = ctx.createGain();
    g.pan = { value: 0, setTargetAtTime() {} };
    return g;
  }

  /** Output node for one voice: an optional stereo position wired into the master bus. */
  function voiceOut(pan) {
    const p = makePan();
    if (typeof pan === 'number') p.pan.value = clamp(pan, -1, 1);
    p.connect(master);
    return p;
  }

  function loopSource(buffer) {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    return s;
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;

    // A gentle limiter keeps a dense passage of the song (or a hard bumper hit) from
    // clipping. Musical, not a safety net for bad levels.
    if (ctx.createDynamicsCompressor) {
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -8;
      comp.knee.value = 6;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;
      master.connect(comp).connect(ctx.destination);
    } else {
      master.connect(ctx.destination);
    }

    noiseBuf = makeNoise(2);
    clickBuf = makeClick();

    // Song bus: every note of the loop and the pad connect here, so one gain fades the
    // whole tune. A dry path runs alongside a short plate so the notes bleed together
    // instead of stopping dead, which is what makes a bare pattern read as a chiptune.
    songGain = ctx.createGain();
    songGain.gain.value = 0;
    const songDry = ctx.createGain();
    songDry.gain.value = 0.85;
    songGain.connect(songDry).connect(master);
    if (ctx.createConvolver) {
      const plate = ctx.createConvolver();
      plate.buffer = makeImpulse();
      const songWet = ctx.createGain();
      songWet.gain.value = 0.3;
      songGain.connect(plate).connect(songWet).connect(master);
    } else {
      songGain.connect(master);
    }

    // Pad: a held root and fifth under the pattern (A2 + E3), two slightly detuned
    // oscillators each so they beat gently and the ear stops hearing one static tone. It
    // exists only to fill out the low-mid; keep it quiet or the loop turns to mud.
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 800;
    padFilter.Q.value = 0.6;
    padGain = ctx.createGain();
    padGain.gain.value = 0;
    // The pad leans toward the marble, so it thickens the mix without erasing where the
    // ball is. Only partway: the internal spread above is what gives the mix its width.
    padPan = makePan();
    padFilter.connect(padGain).connect(padPan).connect(songGain);
    for (const [f, pan] of [[110, -0.45], [165, 0.45]]) {
      const p = makePan();
      p.pan.value = pan;
      p.connect(padFilter);
      for (const [det, g] of [[0, 0.5], [0.7, 0.4]]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f + det;
        const og = ctx.createGain();
        og.gain.value = g;
        o.connect(og).connect(p);
        o.start();
      }
    }

    // Wall friction: the hiss the ball makes scraping along a wall.
    slideSrc = loopSource(noiseBuf);
    slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.value = 900;
    slideFilter.Q.value = 1.3;
    slideGain = ctx.createGain();
    slideGain.gain.value = 0;
    slidePan = makePan();
    slideSrc.connect(slideFilter).connect(slideGain).connect(slidePan).connect(master);
    slideSrc.start();

    // Vent / fan air.
    windSrc = loopSource(noiseBuf);
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.55;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windPan = makePan();
    windSrc.connect(windFilter).connect(windGain).connect(windPan).connect(master);
    windSrc.start();

    // Magnet field: two slightly detuned lows beating against each other.
    humA = ctx.createOscillator();
    humA.type = 'sawtooth';
    humA.frequency.value = 58;
    humB = ctx.createOscillator();
    humB.type = 'sawtooth';
    humB.frequency.value = 58.9;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 220;
    humGain = ctx.createGain();
    humGain.gain.value = 0;
    humPan = makePan();
    humA.connect(humFilter);
    humB.connect(humFilter);
    humFilter.connect(humGain).connect(humPan).connect(master);
    humA.start();
    humB.start();
  }

  // ---------------------------------------------------------------- voices

  function tone({ freq = 440, type = 'sine', dur = 0.2, gain = 0.2, attack = 0.004, slide = 0, delay = 0, pan = 0, out = null }) {
    if (!ctx) return;
    const t0 = now() + delay;
    const o = out || voiceOut(pan);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, attack + 0.01));
    osc.connect(g).connect(o);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /**
   * A struck body: a list of [frequency, weight] partials. Higher partials decay faster,
   * which is what makes wood sound like wood and brass like brass.
   */
  function struck(partials, { dur = 0.1, gain = 0.2, type = 'sine', pan = 0, attack = 0.001, out = null } = {}) {
    if (!ctx) return;
    const t0 = now();
    const o = out || voiceOut(pan);
    for (const [f, w] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, t0);
      const d = dur * clamp(Math.sqrt(600 / f), 0.3, 1.5);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * w), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(d, attack + 0.01));
      osc.connect(g).connect(o);
      osc.start(t0);
      osc.stop(t0 + d + 0.05);
    }
  }

  /** The transient: a band of noise a few milliseconds long. */
  function click({ gain = 0.2, freq = 2600, q = 1.2, dur = 0.02, pan = 0, delay = 0, rate = null, out = null } = {}) {
    if (!ctx) return;
    const t0 = now() + delay;
    const o = out || voiceOut(pan);
    const src = ctx.createBufferSource();
    src.buffer = clickBuf;
    src.playbackRate.value = rate ?? clamp(freq / 1200, 0.6, 3);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, 0.004));
    src.connect(f).connect(g).connect(o);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** A burst of the noise bed through a filter: thuds, friction, air. */
  function noiseHit({ dur = 0.12, gain = 0.2, freq = 900, q = 1.0, type = 'lowpass', delay = 0, pan = 0, out = null } = {}) {
    if (!ctx) return;
    const t0 = now() + delay;
    const o = out || voiceOut(pan);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(o);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // Wood: hollow, mid-heavy, short. Steel: bright inharmonic ring. Ice: glassy tick.
  const WOOD_BODY = [[200, 1], [420, 0.55], [790, 0.2]];
  const STEEL_BODY = [[1180, 1], [2520, 0.6], [4180, 0.4], [5360, 0.2]];
  const ICE_BODY = [[1900, 1], [3200, 0.5]];

  /**
   * A marble against a wall, a peg or a moving arm. `power` 0..1, `hard` for kickers
   * and rapid hits, `surface` picks the body it is striking.
   */
  function knock(power = 0.5, hard = false, surface = 'wood', pan = 0) {
    if (!ctx) return;
    const p = clamp(power, 0, 1);
    const v = 0.35 + p * 0.65;
    if (surface === 'steel') {
      click({ gain: 0.05 + v * 0.10, freq: 5200, q: 1.6, dur: 0.012, pan });
      struck(STEEL_BODY, { dur: 0.5 + p * 0.5, gain: 0.05 + v * 0.13, pan });
      return;
    }
    if (surface === 'ice') {
      click({ gain: 0.06 + v * 0.12, freq: 4200, q: 1.2, dur: 0.015, pan });
      struck(ICE_BODY, { dur: 0.08, gain: 0.05 + v * 0.09, pan });
      return;
    }
    if (surface === 'sand') {
      noiseHit({ dur: 0.10, gain: 0.05 + v * 0.10, freq: 320, q: 0.7, pan });
      struck([[150, 1], [280, 0.5]], { dur: 0.12, gain: 0.06 + v * 0.10, pan, type: 'triangle' });
      return;
    }
    // Wood: a dull knock, not a ping. The contact is a low, short tick and the board
    // answers underneath it with almost no ring at all — a dead hit, the way a ball
    // against a soft wooden wall actually sounds.
    click({ gain: 0.10 + v * 0.22, freq: hard ? 1900 : 1250, q: 0.9, dur: hard ? 0.012 : 0.02, pan });
    struck(WOOD_BODY, { dur: hard ? 0.11 : 0.075, gain: 0.07 + v * 0.15, pan, type: 'triangle' });
    noiseHit({ dur: 0.035, gain: 0.03 + v * 0.06, freq: 420, q: 0.7, pan });
    if (hard) struck([[130, 1], [205, 0.5]], { dur: 0.14, gain: 0.09 + p * 0.12, pan });
  }

  // -------------------------------------------------------------- the song

  //  The roll is a looping pattern, not a simulation of contact. Speed sets its tempo;
  //  the ground under the marble sets how each note is voiced. Keep the note count low
  //  and the level modest: this is a bed the impacts sit on top of, not a soundtrack.
  const SONG = {
    minBpm: 60, // a parked marble still keeps time; the tempo never drops below this
    maxBpm: 190,
    bpmPerSpeed: 34, // board units/s added to the tempo
    root: 220, // A3; the pattern walks a minor pentatonic above it
    scale: [0, 3, 5, 7, 10, 12, 15],
    pattern: [0, 2, 4, 2, 3, 4, 2, 0],
    bassSteps: [0, 4],
  };

  // One timbre per ground. A filter, a decay scale, an optional inharmonic overtone and a
  // pad tone are enough to tell hollow wood from glassy ice from muted sand from ringing
  // steel. `unison` is the detune, in cents, of the second oscillator on every note: a
  // little of it is what keeps a single triangle from sounding like a game console beep.
  const SONG_TIMBRE = {
    wood: { type: 'triangle', filter: 'lowpass', hz: 1500, Q: 0.8, decay: 1.0, detune: 0, unison: 7, overtone: 0, overtoneGain: 0, pad: 800 },
    // Ice keeps its low fundamental (a highpass here would gut the melody) but adds a bright,
    // slightly inharmonic partial, which is what makes it read as glass rather than a flute.
    ice: { type: 'sine', filter: 'lowpass', hz: 4500, Q: 0.7, decay: 0.6, detune: 0, unison: 5, overtone: 3.01, overtoneGain: 0.22, pad: 1800 },
    sand: { type: 'triangle', filter: 'lowpass', hz: 620, Q: 1.1, decay: 0.55, detune: 0, unison: 4, overtone: 0, overtoneGain: 0, pad: 460 },
    // A square is the most 8-bit thing in the file, so steel is a triangle + inharmonic
    // partial instead: still a ring, without the buzzy edge.
    steel: { type: 'triangle', filter: 'bandpass', hz: 1900, Q: 2.4, decay: 0.9, detune: 0, unison: 6, overtone: 2.76, overtoneGain: 0.3, pad: 1100 },
  };

  function songOut(pan) {
    const p = makePan();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(songGain);
    return p;
  }

  /** One note of the loop, voiced for the surface under the marble. */
  function songNote(freq, t0, { gain, dur, pan, surface, bass = false }) {
    const spec = SONG_TIMBRE[surface] || SONG_TIMBRE.wood;
    const d = dur * spec.decay * (bass ? 1.4 : 1);
    const f = ctx.createBiquadFilter();
    f.type = spec.filter;
    f.frequency.value = spec.hz * (bass ? 0.5 : 1);
    f.Q.value = spec.Q;
    f.connect(songOut(pan));
    const partial = (mult, g, cents = 0) => {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(freq * mult, t0);
      osc.detune.setValueAtTime((spec.detune || 0) + cents, t0);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * g), t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(d, 0.02));
      osc.connect(env).connect(f);
      osc.start(t0);
      osc.stop(t0 + d + 0.05);
    };
    if (bass) {
      partial(1, 1);
    } else {
      // Two voices a few cents apart: the top of the note, thickened.
      partial(1, 0.62);
      partial(1, 0.44, spec.unison);
    }
    if (spec.overtone) partial(spec.overtone, spec.overtoneGain);
  }

  function playStep(step, t0, pan) {
    const freq = SONG.root * Math.pow(2, SONG.scale[SONG.pattern[step]] / 12);
    songNote(freq, t0, { gain: 0.05, dur: 0.3, pan, surface: songSurface });
    if (SONG.bassSteps.includes(step)) {
      songNote(freq / 2, t0, { gain: 0.08, dur: 0.5, pan: 0, surface: songSurface, bass: true });
    }
  }

  /**
   * The looping song. `speed` sets the tempo (floored at SONG.minBpm) and `surface` the
   * timbre. Steps are scheduled a little ahead of the clock, which is what keeps the
   * rhythm steady when a frame runs long.
   */
  function rolling(speed = 0, surface = 'wood', dt = 0.016, pan = 0) {
    if (!ctx || !songGain) return;
    const t = now();
    const spec = SONG_TIMBRE[surface] || SONG_TIMBRE.wood;
    songSurface = SONG_TIMBRE[surface] ? surface : 'wood';
    // A parked marble keeps the beat but sits back; a rolling one comes forward.
    songGain.gain.setTargetAtTime(speed < 0.03 ? 0.55 : 1, t, 0.25);

    // The pad fills in behind the notes. It also opens up with speed, so a fast roll is
    // both busier and fuller and a stationary marble stays discreet. Keep it low: the pad
    // is the body of the mix, and at any real level it erases the marble's stereo position.
    padGain.gain.setTargetAtTime(0.01 + 0.015 * Math.min(1, speed / 2.6), t, 0.4);
    padFilter.frequency.setTargetAtTime(spec.pad, t, 0.5);
    padPan.pan.setTargetAtTime(clamp(pan, -1, 1) * 0.6, t, 0.15);

    const bpm = clamp(SONG.minBpm + speed * SONG.bpmPerSpeed, SONG.minBpm, SONG.maxBpm);
    const stepDur = 30 / bpm; // eighth notes
    if (!songNextT || songNextT < t) songNextT = t + 0.02;
    const horizon = t + 0.14;
    let guard = 0;
    while (songNextT < horizon && guard++ < 16) {
      playStep(songStep, songNextT, pan);
      songStep = (songStep + 1) % SONG.pattern.length;
      songNextT += stepDur;
    }
  }

  function stopRolling() {
    if (!ctx) return;
    const t = now();
    songGain.gain.setTargetAtTime(0, t, 0.08);
    // Drop the clock so the next roll starts the pattern cleanly on its first frame.
    songNextT = 0;
    slideGain.gain.setTargetAtTime(0, t, 0.05);
    windGain.gain.setTargetAtTime(0, t, 0.1);
    humGain.gain.setTargetAtTime(0, t, 0.1);
  }

  /** Wall friction, driven by the tangential speed at the contact. */
  function scrape(tangent = 0, surface = 'wood', pan = 0) {
    if (!ctx || !slideGain) return;
    const t = now();
    const v = clamp((tangent - 0.15) / 1.4, 0, 1);
    const hz = surface === 'ice' ? 2400 : surface === 'steel' ? 1600 : 900;
    slideFilter.frequency.setTargetAtTime(hz, t, 0.08);
    slideGain.gain.setTargetAtTime(v * 0.2, t, 0.04);
    slidePan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.06);
  }

  /** Air moving over the marble on a vent. */
  function wind(amount = 0, pan = 0) {
    if (!ctx || !windGain) return;
    const t = now();
    windGain.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.13, t, 0.15);
    windPan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.15);
  }

  /** A near-field magnet: a low beat that rises as the marble gets closer. */
  function magnet(amount = 0, pan = 0) {
    if (!ctx || !humGain) return;
    const t = now();
    humGain.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.035, t, 0.2);
    humPan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.2);
  }

  return {
    unlock() {
      init();
      if (!ctx) return;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      started = true;
    },
    get ready() {
      return started;
    },
    /** Test hook: lets a headless check render the graph without a speaker. */
    get context() {
      return ctx;
    },
    setEnabled(on) {
      enabled = on;
      if (master) master.gain.value = on ? 0.9 : 0;
    },
    get enabled() {
      return enabled;
    },

    rolling,
    stopRolling,
    scrape,
    wind,
    magnet,

    /** A wall, peg, bumper or moving arm. */
    bump(power = 0.5, hard = false, surface = 'wood', pan = 0) {
      knock(power, hard, surface, pan);
    },
    /** Brass pegs and kickers get their own brighter ring. */
    peg(hard = false, pan = 0) {
      if (!ctx) return;
      click({ gain: hard ? 0.16 : 0.08, freq: 5400, q: 1.5, dur: 0.01, pan });
      struck(STEEL_BODY, { dur: 0.35, gain: hard ? 0.16 : 0.09, pan });
    },
    /** A press plate: brass click, then the latch underneath it. */
    plate(pan = 0) {
      click({ gain: 0.14, freq: 4600, q: 1.3, dur: 0.012, pan });
      struck([[1560, 1], [2620, 0.6], [4100, 0.35]], { dur: 0.32, gain: 0.10, pan });
      struck([[220, 1], [330, 0.5]], { dur: 0.08, gain: 0.07, pan, type: 'triangle' });
      click({ gain: 0.06, freq: 2600, q: 1.0, dur: 0.01, delay: 0.05, pan });
    },
    /** A gate slamming shut: heavy wood, then the latch. */
    gate(pan = 0) {
      struck([[170, 1], [430, 0.6], [900, 0.25]], { dur: 0.22, gain: 0.20, pan, type: 'triangle' });
      noiseHit({ dur: 0.2, gain: 0.12, freq: 300, q: 0.7, pan });
      click({ gain: 0.08, freq: 2200, q: 1.1, dur: 0.012, delay: 0.07, pan });
    },
    teleport(pan = 0) {
      tone({ freq: 300, type: 'sine', dur: 0.3, gain: 0.12, slide: 900, pan });
      tone({ freq: 480, type: 'triangle', dur: 0.28, gain: 0.07, slide: 700, delay: 0.03, pan });
      tone({ freq: 720, type: 'sine', dur: 0.4, gain: 0.035, slide: 1100, delay: 0.06, pan });
    },
    /** The rollers under a conveyor belt. Emitted a few times a second while on it. */
    belt(pan = 0) {
      noiseHit({ dur: 0.28, gain: 0.045, freq: 260, q: 1.2, type: 'bandpass', pan });
      tone({ freq: 88, type: 'sawtooth', dur: 0.26, gain: 0.02, pan });
    },
    /** Into a pit: the rim clacks, then the sound falls away down the hole. */
    pit(pan = 0) {
      knock(0.8, true, 'wood', pan);
      tone({ freq: 420, type: 'sine', dur: 0.5, gain: 0.16, slide: -330, delay: 0.02, pan });
      noiseHit({ dur: 0.45, gain: 0.09, freq: 700, q: 0.8, delay: 0.02, pan });
      tone({ freq: 140, type: 'triangle', dur: 0.4, gain: 0.09, slide: -60, delay: 0.24, pan });
    },
    /** Off the board edge: a scrape, then the drop. */
    edge(pan = 0) {
      noiseHit({ dur: 0.12, gain: 0.08, freq: 1200, q: 1.0, type: 'bandpass', pan });
      tone({ freq: 300, type: 'sine', dur: 0.65, gain: 0.15, slide: -220, delay: 0.05, pan });
      noiseHit({ dur: 0.35, gain: 0.08, freq: 400, q: 0.6, delay: 0.05, pan });
    },
    /** Set down on the board at spawn or after a fall. */
    place(pan = 0) {
      knock(0.3, false, 'wood', pan);
      struck([[300, 1], [500, 0.4]], { dur: 0.05, gain: 0.05, pan, type: 'triangle' });
    },
    /** The marble coming to rest: one last contact, quieter than a bump. */
    settle(pan = 0) {
      click({ gain: 0.06, freq: 2100, q: 1.2, dur: 0.016, pan });
      struck(WOOD_BODY, { dur: 0.07, gain: 0.05, pan, type: 'triangle' });
    },
    /** The board moving in your hands. Quiet, and only on a fast tilt. */
    creak(amount = 0.5, pan = 0) {
      const a = clamp(amount, 0, 1);
      tone({ freq: 84, type: 'sawtooth', dur: 0.32, gain: 0.016 * a, slide: 26, pan });
      noiseHit({ dur: 0.3, gain: 0.02 * a, freq: 170, q: 5, type: 'bandpass', pan });
    },
    /** Into the brass cup: the ring, then the game's flourish. */
    win(pan = 0) {
      struck([[1568, 1], [2349, 0.55], [3136, 0.3], [4699, 0.15]], { dur: 1.1, gain: 0.11, pan });
      click({ gain: 0.10, freq: 5200, q: 1.4, dur: 0.014, pan });
      tone({ freq: 392, type: 'sine', dur: 0.5, gain: 0.05, delay: 0.02, pan });
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.55, gain: 0.12, delay: 0.34 + i * 0.11, pan }));
      tone({ freq: 261.63, type: 'sine', dur: 1.2, gain: 0.09, delay: 0.38, pan });
    },
    tick() {
      tone({ freq: 1200, type: 'square', dur: 0.02, gain: 0.03 });
    },
  };
}
