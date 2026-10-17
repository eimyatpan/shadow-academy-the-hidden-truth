const STORAGE_KEY = 'shadow-academy-phase4-settings';

export const DEFAULT_SETTINGS = {
  musicVolume: 28,
  effectsVolume: 42,
  musicMuted: false,
  effectsMuted: false,
  animationsEnabled: !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      musicVolume: clamp(saved.musicVolume ?? DEFAULT_SETTINGS.musicVolume),
      effectsVolume: clamp(saved.effectsVolume ?? DEFAULT_SETTINGS.effectsVolume)
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Storage may be unavailable in private browsing. */ }
}

function clamp(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }

const SCORE = {
  lobby: { chord: [110, 164.81, 220, 329.63], melody: [440, 392, 329.63, 293.66, 392, 329.63, 261.63, 329.63], pace: 2800 },
  opening: { chord: [98, 146.83, 196, 293.66], melody: [392, 349.23, 293.66, 261.63, 349.23, 293.66, 220, 293.66], pace: 3300 },
  library: { chord: [110, 164.81, 220, 261.63], melody: [440, 392, 329.63, 392, 293.66, 329.63, 261.63, 329.63], pace: 3000 },
  corridor: { chord: [92.5, 138.59, 185, 277.18], melody: [369.99, 329.63, 277.18, 311.13, 246.94, 277.18, 207.65, 277.18], pace: 3200 },
  tower: { chord: [82.41, 123.47, 164.81, 246.94], melody: [329.63, 293.66, 246.94, 277.18, 220, 246.94, 185, 246.94], pace: 2450 },
  voting: { chord: [73.42, 110, 146.83, 220], melody: [293.66, 261.63, 220, 246.94, 196, 220, 164.81, 220], pace: 2650 },
  shadow: { chord: [73.42, 110, 164.81, 220], melody: [293.66, 246.94, 220, 196, 246.94, 220, 164.81, 196], pace: 2500 },
  investigator: { chord: [110, 164.81, 220, 329.63], melody: [392, 440, 493.88, 440, 392, 329.63, 392, 440], pace: 2500 },
  defeat: { chord: [98, 146.83, 196, 293.66], melody: [293.66, 261.63, 220, 196, 261.63, 220, 196, 174.61], pace: 3000 }
};

class AcademyAudio {
  constructor() {
    this.context = null;
    this.musicBus = null;
    this.effectsBus = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.scene = null;
    this.arrangement = null;
    this.sequenceTimer = null;
    this.noteIndex = 0;
    this.unlocked = false;
    this.lastUiSound = 0;
  }

  async unlock(settings = this.settings) {
    this.settings = settings;
    if (!globalThis.AudioContext && !globalThis.webkitAudioContext) return false;
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.context = new Context();
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 3;
      compressor.connect(this.context.destination);
      this.musicBus = this.context.createGain();
      this.effectsBus = this.context.createGain();
      this.musicBus.connect(compressor);
      this.effectsBus.connect(compressor);
    }
    try {
      await this.context.resume();
      this.unlocked = this.context.state === 'running';
      this.applySettings(settings);
      if (this.unlocked && this.scene) { const pendingScene = this.scene; this.scene = null; this.setScene(pendingScene, settings); }
      return this.unlocked;
    } catch { return false; }
  }

  applySettings(settings) {
    this.settings = settings;
    if (!this.context || !this.musicBus || !this.effectsBus) return;
    const now = this.context.currentTime;
    this.musicBus.gain.setTargetAtTime(settings.musicMuted ? 0 : clamp(settings.musicVolume) / 100 * 0.78, now, 0.08);
    this.effectsBus.gain.setTargetAtTime(settings.effectsMuted ? 0 : clamp(settings.effectsVolume) / 100 * 0.72, now, 0.04);
  }

  setScene(scene, settings = this.settings) {
    this.settings = settings;
    if (this.scene === scene) { this.applySettings(settings); return; }
    this.scene = scene;
    if (!this.unlocked || !this.context || !this.musicBus) return;
    this.stopArrangement();
    const score = SCORE[scene] || SCORE.lobby;
    const now = this.context.currentTime;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.62, now + 1.4);
    gain.connect(this.musicBus);
    const nodes = [];
    score.chord.forEach((frequency, index) => {
      const osc = this.context.createOscillator();
      const voice = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      osc.type = index === 0 ? 'sine' : 'triangle';
      osc.frequency.value = frequency;
      filter.type = 'lowpass';
      filter.frequency.value = index === 0 ? 500 : 1350;
      voice.gain.value = index === 0 ? 0.28 : 0.075;
      osc.connect(filter); filter.connect(voice); voice.connect(gain); osc.start();
      nodes.push(osc);
    });
    if (scene === 'corridor' || scene === 'tower') {
      const sampleRate = this.context.sampleRate || 44100;
      const buffer = this.context.createBuffer(1, sampleRate * 2, sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = (Math.random() * 2 - 1) * 0.32;
      const wind = this.context.createBufferSource();
      const windFilter = this.context.createBiquadFilter();
      const windGain = this.context.createGain();
      wind.buffer = buffer; wind.loop = true;
      windFilter.type = 'lowpass'; windFilter.frequency.value = scene === 'corridor' ? 320 : 190;
      windGain.gain.value = scene === 'corridor' ? 0.045 : 0.025;
      wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(gain); wind.start();
      nodes.push(wind);
    }
    this.arrangement = { gain, nodes };
    this.noteIndex = 0;
    this.playMotifNote(score, gain);
    this.sequenceTimer = setInterval(() => this.playMotifNote(score, gain), score.pace);
    this.applySettings(settings);
  }

  playMotifNote(score, destination) {
    if (!this.context || this.context.state !== 'running' || this.arrangement?.gain !== destination) return;
    const now = this.context.currentTime;
    const frequency = score.melody[this.noteIndex % score.melody.length];
    this.noteIndex += 1;
    const osc = this.context.createOscillator();
    const env = this.context.createGain();
    const tone = this.context.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.997, now + 1.8);
    tone.type = 'lowpass'; tone.frequency.value = 1050;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.085, now + 0.18);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 2.1);
    osc.connect(tone); tone.connect(env); env.connect(destination);
    osc.start(now); osc.stop(now + 2.15);
  }

  stopArrangement() {
    if (this.sequenceTimer) clearInterval(this.sequenceTimer);
    this.sequenceTimer = null;
    if (!this.arrangement || !this.context) return;
    const old = this.arrangement;
    const now = this.context.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), now);
    old.gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    old.nodes.forEach((node) => { try { node.stop(now + 1.2); } catch { /* Already stopped. */ } });
    setTimeout(() => { try { old.gain.disconnect(); } catch { /* Already disconnected. */ } }, 1500);
    this.arrangement = null;
  }

  playSfx(kind = 'ui') {
    if (!this.unlocked || !this.context || this.context.state !== 'running' || this.settings.effectsMuted) return;
    const now = this.context.currentTime;
    if (kind === 'ui' && now - this.lastUiSound < 0.08) return;
    if (kind === 'ui') this.lastUiSound = now;
    const patterns = {
      ui: [659.25], dialogue: [523.25, 659.25], clue: [659.25, 783.99, 987.77], evidence: [587.33, 739.99], bell: [440, 659.25], reveal: [392, 523.25, 783.99], vote: [493.88, 587.33]
    };
    const notes = patterns[kind] || patterns.ui;
    notes.forEach((frequency, index) => {
      const start = now + index * (kind === 'clue' || kind === 'reveal' ? 0.105 : 0.065);
      const osc = this.context.createOscillator();
      const env = this.context.createGain();
      const tone = this.context.createBiquadFilter();
      osc.type = kind === 'ui' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(frequency, start);
      if (kind === 'bell') osc.frequency.exponentialRampToValueAtTime(frequency * 0.992, start + 1.5);
      tone.type = 'lowpass'; tone.frequency.value = kind === 'ui' ? 1000 : 1800;
      const peak = kind === 'ui' ? 0.028 : kind === 'bell' ? 0.12 : 0.075;
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(peak, start + 0.018);
      env.gain.exponentialRampToValueAtTime(0.0001, start + (kind === 'bell' ? 1.7 : 0.52));
      osc.connect(tone); tone.connect(env); env.connect(this.effectsBus);
      osc.start(start); osc.stop(start + (kind === 'bell' ? 1.75 : 0.56));
    });
  }
}

export const academyAudio = new AcademyAudio();
