import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value))
};

class Param {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class Node {
  constructor() { this.gain = new Param(); this.frequency = new Param(); this.connections = []; }
  connect(destination) { this.connections.push(destination); }
  disconnect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  static instances = [];
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 44100; this.destination = new Node(); FakeAudioContext.instances.push(this); }
  createDynamicsCompressor() { const node = new Node(); node.threshold = new Param(); node.knee = new Param(); node.ratio = new Param(); return node; }
  createGain() { return new Node(); }
  createOscillator() { return new Node(); }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { return new Node(); }
  createBiquadFilter() { const node = new Node(); node.type = ''; return node; }
  async resume() { this.state = 'running'; }
}
globalThis.AudioContext = FakeAudioContext;

const { academyAudio, DEFAULT_SETTINGS, loadSettings, saveSettings } = await import('../client/src/audio.js');
assert.equal(FakeAudioContext.instances.length, 0, 'AudioContext must not be created before a user gesture.');
assert.equal(academyAudio.setScene('lobby'), undefined);
assert.equal(FakeAudioContext.instances.length, 0, 'Scene selection alone must remain silent before opt-in.');

const saved = { ...DEFAULT_SETTINGS, musicVolume: 19, effectsVolume: 33, musicMuted: true, animationsEnabled: false };
saveSettings(saved);
assert.deepEqual(loadSettings(), saved, 'Audio/display settings must persist and restore.');
assert.equal(await academyAudio.unlock(saved), true, 'Explicit unlock must resume audio.');
assert.equal(FakeAudioContext.instances.length, 1, 'Unlock must reuse one audio context.');
assert.equal(academyAudio.arrangement !== null, true, 'Unlock starts the pending scene score.');
const lobbyArrangement = academyAudio.arrangement;
academyAudio.setScene('lobby', saved);
assert.equal(academyAudio.arrangement, lobbyArrangement, 'Repeated snapshots in the same scene must not restart music.');
academyAudio.setScene('opening', saved);
assert.notEqual(academyAudio.arrangement, lobbyArrangement, 'A scene transition swaps the musical motif.');
academyAudio.setScene('corridor', saved);
assert.equal(academyAudio.arrangement.nodes.length, 5, 'Corridor scene adds one subtle locally generated wind layer.');
const corridorArrangement = academyAudio.arrangement;
academyAudio.setScene('corridor', saved);
assert.equal(academyAudio.arrangement, corridorArrangement, 'The same investigation scene does not stack or restart its ambience.');
academyAudio.setScene('tower', saved);
assert.equal(academyAudio.arrangement.nodes.length, 5, 'Clock tower adds one subtle locally generated wind layer.');
academyAudio.applySettings({ ...saved, musicMuted: true, effectsMuted: true });
assert.equal(academyAudio.musicBus.gain.value, 0, 'Music mute must silence the music bus.');
assert.equal(academyAudio.effectsBus.gain.value, 0, 'Effects mute must silence the effects bus.');
academyAudio.playSfx('clue');
academyAudio.setScene('lobby', DEFAULT_SETTINGS);
academyAudio.stopArrangement();
console.log('Audio opt-in, persistence, scene changes, no-restart behavior and mute controls: passed');
