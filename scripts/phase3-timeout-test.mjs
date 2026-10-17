import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const serverUrl = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3001';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(serverUrl, { transports: ['websocket'], reconnection: false, timeout: 5000 });
    const timer = setTimeout(() => reject(new Error('Socket timed out.')), 6000);
    socket.once('connect', () => { clearTimeout(timer); socket.latestSnapshot = null; socket.on('room:snapshot', (value) => { socket.latestSnapshot = value; }); resolve(socket); });
    socket.once('connect_error', reject);
  });
}
function emit(socket, event, data = {}) {
  return new Promise((resolve, reject) => socket.emit(event, data, (result) => result?.ok ? resolve(result) : reject(new Error(result?.error || `${event} failed`))));
}
async function wait(socket, predicate, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (socket.latestSnapshot && predicate(socket.latestSnapshot)) return socket.latestSnapshot;
    await pause(15);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const players = [await connect(), await connect()];
try {
  const created = await emit(players[0], 'room:create', { name: 'ClockA' });
  await emit(players[1], 'room:join', { name: 'ClockB', code: created.room.code });
  for (const [index, player] of players.entries()) {
    await emit(player, 'player:character', { characterId: index ? 'ren' : 'aoi' });
    await emit(player, 'player:ready', { ready: true });
  }
  await emit(players[0], 'game:start');
  await Promise.all(players.map((player) => wait(player, ({ room }) => room.phase === 'roleReveal', 'role reveal')));
  await Promise.all(players.map((player) => emit(player, 'player:confirm-role')));
  await Promise.all(players.map((player) => wait(player, ({ room }) => room.phase === 'storyIntro', 'story intro')));
  await Promise.all(players.map((player) => emit(player, 'story:intro-skip')));
  await Promise.all(players.map((player) => wait(player, ({ room }) => room.phase === 'investigation', 'round one')));
  const configuredRoundMs = Number(process.env.ROUND_TIME_LIMIT_MS) || 90_000;
  assert(players[0].latestSnapshot.room.roundDeadline - Date.now() <= configuredRoundMs + 500);

  await wait(players[0], ({ room }) => room.phase === 'investigation' && room.round === 2, 'round one auto-submit', configuredRoundMs + 4000);
  assert(players[0].latestSnapshot.room.publicClues.some((clue) => clue.id === 'mandatory-1'), 'Timeout still adds required case evidence.');
  await wait(players[0], ({ room }) => room.phase === 'investigation' && room.round === 3, 'round two auto-submit', configuredRoundMs + 4000);
  await wait(players[0], ({ room }) => room.phase === 'voting', 'round three auto-submit', configuredRoundMs + 4000);
  assert([1, 2, 3].every((round) => players[0].latestSnapshot.room.publicClues.some((clue) => clue.id === `mandatory-${round}`)), 'Timeout paths preserve all mandatory evidence.');
  await wait(players[0], ({ room }) => room.phase === 'ended', 'automatic vote abstentions', Number(process.env.VOTE_TIME_LIMIT_MS || 60_000) + 4000);
  await Promise.all(players.map((player) => wait(player, ({ room }) => room.phase === 'ended', 'final timeout snapshot')));
  for (const player of players) {
    assert.equal(player.latestSnapshot.room.result.investigatorsWon, false, 'An uncast cooperative vote does not convict.');
    assert.equal(player.latestSnapshot.room.myVote, 'ABSTAIN', 'Vote timeout records an explicit abstention.');
  }
  console.log('Round timeouts: passed (all mandatory evidence preserved)');
  console.log('Voting timeout: passed (private abstentions recorded, cooperative failure shown)');
} finally {
  players.forEach((player) => player.disconnect());
}
