import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { io } from 'socket.io-client';
import { getOpeningDialogue } from '../client/src/storyDialogue.js';
import { CHARACTERS, CHARACTER_EXPRESSIONS } from '../client/src/characters.js';

const serverUrl = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3001';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(serverUrl, { transports: ['websocket'], reconnection: false, timeout: 5000 });
    const timeout = setTimeout(() => reject(new Error('Socket connection timed out.')), 6000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(socket); });
    socket.once('connect_error', reject);
  });
}

function trackSnapshots(socket) {
  socket.latestSnapshot = null;
  socket.on('room:snapshot', (snapshot) => { socket.latestSnapshot = snapshot; });
}

function emitAck(socket, event, data = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} acknowledgement timed out.`)), 6000);
    socket.emit(event, data, (reply) => {
      clearTimeout(timeout);
      if (reply?.ok) resolve(reply);
      else reject(new Error(`${event}: ${reply?.error || 'rejected'}`));
    });
  });
}

function combinations(items, count, start = 0, prefix = [], result = []) {
  if (prefix.length === count) { result.push(prefix); return result; }
  for (let index = start; index < items.length; index += 1) {
    combinations(items, count, index + 1, [...prefix, items[index]], result);
  }
  return result;
}

async function checkEveryCastCombination() {
  const ids = CHARACTERS.map(({ id }) => id);
  let combinationCount = 0;
  for (let size = 2; size <= ids.length; size += 1) {
    for (const cast of combinations(ids, size)) {
      const lines = getOpeningDialogue(cast);
      assert.equal(lines.length, 6);
      assert.deepEqual(new Set(lines.map(({ characterId }) => characterId)), new Set(cast));
      assert(lines.every(({ text, characterId, expression }) => (
        text.trim().length > 0 && CHARACTER_EXPRESSIONS[characterId].includes(expression)
      )));
      const completeScript = lines.map(({ text }) => text).join(' ').toLowerCase();
      for (const requiredStoryFact of ['12:07', 'lock', 'key', 'document', 'forbidden library', 'three rounds', 'culprit']) {
        assert(completeScript.includes(requiredStoryFact), `Cast ${cast.join(',')} missed ${requiredStoryFact}.`);
      }
      const absentNames = CHARACTERS.filter(({ id }) => !cast.includes(id))
        .flatMap(({ name }) => [name, name.split(' ')[0]]);
      for (const line of lines) {
        for (const absentName of absentNames) {
          assert(!line.speakerName.toLowerCase().includes(absentName.toLowerCase()));
          assert(!line.text.toLowerCase().includes(absentName.toLowerCase()));
        }
      }
      combinationCount += 1;
    }
  }
  assert.equal(combinationCount, 57, 'Every supported unique character selection is checked.');

  let imageCount = 0;
  for (const character of CHARACTERS) {
    for (const expression of CHARACTER_EXPRESSIONS[character.id]) {
      const assetPath = path.resolve('client/public/assets/characters/expressions', character.id, `${expression}.webp`);
      const image = await stat(assetPath);
      assert(image.size > 0 && image.size < 500_000, `${character.id}/${expression} is missing or unexpectedly large.`);
      imageCount += 1;
    }
  }
  assert.equal(imageCount, 36, 'All 36 local expression portraits are present and optimized.');
  return `${combinationCount} cast combinations and ${imageCount} portraits: passed`;
}

async function waitForSnapshot(socket, predicate, label) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (socket.latestSnapshot && predicate(socket.latestSnapshot)) return socket.latestSnapshot;
    await pause(15);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function runPlayerCount(count, coopCorrect = true) {
  const sockets = [];
  const sessions = [];
  const characterIds = CHARACTERS.map(({ id }, index) => CHARACTERS[(index + count) % CHARACTERS.length].id);
  try {
    for (let index = 0; index < count; index += 1) {
      const socket = await connect();
      trackSnapshots(socket);
      sockets.push(socket);
    }

    const created = await emitAck(sockets[0], 'room:create', { name: `Cast${count}A` });
    sessions[0] = created.session;
    for (let index = 1; index < count; index += 1) {
      const joined = await emitAck(sockets[index], 'room:join', {
        name: `Cast${count}${String.fromCharCode(65 + index)}`,
        code: created.room.code
      });
      sessions[index] = joined.session;
    }

    for (let index = 0; index < count; index += 1) {
      await emitAck(sockets[index], 'player:character', { characterId: characterIds[index] });
      await emitAck(sockets[index], 'player:ready', { ready: true });
    }
    await emitAck(sockets[0], 'game:start');
    await Promise.all(sockets.map((socket) => waitForSnapshot(socket, ({ room }) => room.phase === 'roleReveal', `${count}-player role reveal`)));
    const shadowIndex = count >= 3 ? sockets.findIndex((socket) => socket.latestSnapshot.me.role === 'Shadow') : -1;
    if (count >= 3) assert(shadowIndex >= 0, 'The server privately assigns one Shadow.');
    await Promise.all(sockets.map((socket) => emitAck(socket, 'player:confirm-role')));
    await waitForSnapshot(sockets[0], ({ room }) => room.phase === 'storyIntro', `${count}-player intro`);

    const cast = sockets[0].latestSnapshot.room.activeStoryCast;
    assert.deepEqual(cast, characterIds.slice(0, count), 'Server cast follows the selected room roster.');
    const lines = getOpeningDialogue(cast);
    assert.equal(lines.length, 6, 'The opening contains all six story beats.');
    assert.deepEqual(new Set(lines.map(({ characterId }) => characterId)), new Set(cast), 'Every active character speaks.');
    assert(lines.every(({ text, characterId, expression }) => (
      text.trim().length > 0 && CHARACTER_EXPRESSIONS[characterId].includes(expression)
    )), 'Every story line has text and a supported expression.');

    const absentNames = CHARACTERS.filter(({ id }) => !cast.includes(id))
      .flatMap(({ name }) => [name, name.split(' ')[0]]);
    for (const line of lines) {
      for (const absentName of absentNames) {
        assert(!line.speakerName.toLowerCase().includes(absentName.toLowerCase()));
        assert(!line.text.toLowerCase().includes(absentName.toLowerCase()));
      }
    }
    for (const socket of sockets) {
      assert.deepEqual(socket.latestSnapshot.room.activeStoryCast, cast, 'All clients receive the same cast.');
      assert.equal(socket.latestSnapshot.room.storyDialogueIndex, 0);
      assert(!socket.latestSnapshot.room.players.some((player) => 'role' in player), 'Role is private during the story.');
    }

    // Verify a reconnect receives the existing room cast and dialogue cursor.
    if (count === 4) {
      sockets[2].disconnect();
      await pause(100);
      const reconnected = await connect();
      trackSnapshots(reconnected);
      sockets[2] = reconnected;
      reconnected.emit('player:reconnect', sessions[2]);
      await waitForSnapshot(reconnected, ({ room }) => room.phase === 'storyIntro', 'reconnected story intro');
      assert.deepEqual(reconnected.latestSnapshot.room.activeStoryCast, cast);
      assert.equal(reconnected.latestSnapshot.room.storyDialogueIndex, 0);
    }

    // All players share one server-side public dialogue cursor.
    for (let index = 0; index < lines.length - 1; index += 1) {
      const currentIndex = sockets[0].latestSnapshot.room.storyDialogueIndex;
      await emitAck(sockets[index % count], 'story:dialogue-advance', { fromIndex: currentIndex });
      await Promise.all(sockets.map((socket) => waitForSnapshot(
        socket,
        ({ room }) => room.storyDialogueIndex === currentIndex + 1,
        `${count}-player shared dialogue line ${currentIndex + 1}`
      )));
    }
    await Promise.all(sockets.map((socket) => emitAck(socket, 'story:intro-complete')));
    await Promise.all(sockets.map((socket) => waitForSnapshot(socket, ({ room }) => room.phase === 'investigation', `${count}-player investigation`)));

    let shadowActionId = null;
    for (let round = 1; round <= 3; round += 1) {
      const sceneObjects = sockets[0].latestSnapshot.room.scene.objects;
      for (let index = 0; index < count; index += 1) {
        const object = sceneObjects[index];
        await emitAck(sockets[index], 'scene:inspect', { objectId: object.id });
      }
      await Promise.all(sockets.map((socket) => waitForSnapshot(socket, ({ room }) => room.foundObjects?.length === count, `${count} clues in round ${round}`)));
      const firstRoom = sockets[0].latestSnapshot.room;
      const missingClueMetadata = firstRoom.publicClues.filter((clue) => !(clue.timestamp && clue.reliability && clue.explanation && Array.isArray(clue.tags))); assert.equal(missingClueMetadata.length, 0, `Shared clues are structured and explain their relevance: ${JSON.stringify(missingClueMetadata)}`);
      if (round === 1 && count >= 3) {
        const shadowSocket = sockets[shadowIndex];
        assert(shadowSocket.latestSnapshot.room.myDeception?.available, 'Only the Shadow receives the one-use action token.');
        for (const [index, socket] of sockets.entries()) {
          if (index !== shadowIndex) assert.equal(socket.latestSnapshot.room.myDeception, null, 'The deception token is private.');
        }
        const abilityType = count % 2 ? 'plant' : 'veil';
        if (abilityType === 'plant') {
          const planted = await emitAck(shadowSocket, 'shadow:deceive', { type: 'plant' });
          assert(planted.ok);
          const decoy = shadowSocket.latestSnapshot.room.publicClues.find((clue) => clue.challengeAvailable);
          assert(decoy, 'The planted clue is shown as unverified but does not expose its owner.');
          assert(!('decoy' in decoy) && !('plantedBy' in decoy));
          shadowActionId = decoy.id;
          await assert.rejects(emitAck(shadowSocket, 'shadow:deceive', { type: 'plant' }), /already been used/);
        } else {
          const optional = shadowSocket.latestSnapshot.room.publicClues.find((clue) => clue.optional);
          assert(optional, 'There is optional evidence available to veil.');
          shadowActionId = optional.id;
          await emitAck(shadowSocket, 'shadow:deceive', { type: 'veil', clueId: optional.id });
          assert(!sockets.find((socket) => socket !== shadowSocket).latestSnapshot.room.publicClues.some((clue) => clue.id === optional.id), 'Veiled clue is hidden from other players temporarily.');
          await assert.rejects(emitAck(shadowSocket, 'shadow:deceive', { type: 'veil', clueId: optional.id }), /already been used/);
        }
        const windowEvidence = sockets[0].latestSnapshot.room.publicClues.some((clue) => clue.tags.includes('window-ruled-out'));
        if (windowEvidence) {
          const asker = sockets.find((_, index) => index !== shadowIndex);
          const targetIndex = sockets.indexOf(asker) === 0 ? 1 : 0;
          const target = sockets[targetIndex];
          await emitAck(asker, 'question:ask', { targetId: target.latestSnapshot.me.id, promptIndex: 1 });
          await Promise.all([waitForSnapshot(target, ({ room }) => room.question?.targetId === target.latestSnapshot.me.id, 'target question'), waitForSnapshot(asker, ({ room }) => room.question?.targetId === target.latestSnapshot.me.id, 'public question')]);
          const question = target.latestSnapshot.room.question;
          assert(question?.targetId === target.latestSnapshot.me.id && target.latestSnapshot.room.responseOptions.length > 0, 'Question is synchronized and response choices are private to the target.');
          assert.equal(asker.latestSnapshot.room.responseOptions.length, 0, 'Other players do not receive response controls.');
          await emitAck(target, 'question:respond', { questionId: question.id, responseId: 'window-entry' });
          await waitForSnapshot(asker, ({ room }) => room.statements?.length > 0, 'public response');
          assert(asker.latestSnapshot.room.statements.at(-1).contradicted, 'Player response is linked to a verified contradiction.');
          assert(!asker.latestSnapshot.room.players.some((player) => 'role' in player));
        }
      }
      for (const socket of sockets) {
        await emitAck(socket, 'round:choose', { optionId: socket.latestSnapshot.room.options[0].id });
      }
      const nextPhase = round < 3 ? 'investigation' : 'voting';
      await Promise.all(sockets.map((socket) => waitForSnapshot(socket, ({ room }) => (
        room.phase === nextPhase && (round === 3 || room.round === round + 1)
      ), `${count}-player round ${round}`)));
      if (round === 1 && count >= 3 && count % 2 === 1 && shadowActionId) {
        const challenge = sockets.find((socket) => socket.latestSnapshot.room.publicClues.some((clue) => clue.id === shadowActionId)) || sockets[0];
        if (challenge.latestSnapshot.room.publicClues.find((clue) => clue.id === shadowActionId)?.challengeAvailable) {
          await emitAck(challenge, 'evidence:challenge', { clueId: shadowActionId });
          assert(challenge.latestSnapshot.room.conclusions.some((clue) => clue.title === 'The Window Report Is Contradicted'), 'Investigators can challenge a misleading clue using the latch evidence.');
        }
      }
      if (round === 1 && count >= 4 && count % 2 === 0 && shadowActionId) {
        assert(sockets.some((socket) => socket.latestSnapshot.room.publicClues.some((clue) => clue.id === shadowActionId)), 'A veiled clue automatically returns next round.');
      }
    }

    if (count === 2) {
      await Promise.all(sockets.map((socket) => emitAck(socket, 'vote:submit', { suspectId: coopCorrect ? 'Head Librarian Kisaragi' : 'Night Guard Mori' })));
    } else if (count === 4 || count === 6) {
      const others = sockets.filter((_, index) => index !== shadowIndex);
      const alternative = others[0].latestSnapshot.me.id;
      const shadowToAlternative = sockets[shadowIndex].latestSnapshot.me.id !== alternative ? alternative : others[1].latestSnapshot.me.id;
      await emitAck(sockets[shadowIndex], 'vote:submit', { suspectId: shadowToAlternative });
      for (let index = 0; index < others.length; index += 1) {
        const target = index > 0 && index < count / 2 ? shadowToAlternative : sockets[shadowIndex].latestSnapshot.me.id;
        await emitAck(others[index], 'vote:submit', { suspectId: target });
      }
    } else {
      const shadowId = sockets[shadowIndex].latestSnapshot.me.id;
      for (let index = 0; index < count; index += 1) {
        const target = index === shadowIndex
          ? sockets.find((_, candidateIndex) => candidateIndex !== shadowIndex).latestSnapshot.me.id
          : shadowId;
        await emitAck(sockets[index], 'vote:submit', { suspectId: target });
      }
    }

    await Promise.all(sockets.map((socket) => waitForSnapshot(socket, ({ room }) => room.phase === 'ended', `${count}-player ending`)));
    for (const socket of sockets) {
      assert(socket.latestSnapshot.room.result?.caseOutcome, 'The factual case outcome is shared.');
      if (count > 2) {
        assert.equal(socket.latestSnapshot.room.result.thiefName, 'Head Librarian Kisaragi', 'The document thief is distinct and fixed.');
        assert(socket.latestSnapshot.room.result.shadowName, 'The student Shadow is revealed after the vote.');
        assert(socket.latestSnapshot.room.result.explanation.includes(socket.latestSnapshot.room.result.shadowName), 'The ending explains the Shadow’s connection.');
      }
      assert(!socket.latestSnapshot.room.players.some((player) => 'role' in player), 'Public roster does not reveal roles.');
      assert(!socket.latestSnapshot.room.players.some((player) => 'privateClues' in player || 'myClues' in player), 'Private clues are not attached to public player entries.');
      assert.equal(socket.latestSnapshot.room.myClues.length, 3, 'Each player retains their own three round clues.');
      assert.equal(socket.latestSnapshot.room.activeStoryCast.length, count);
    }
    if (count === 3 || count === 5) assert.equal(sockets[shadowIndex].latestSnapshot.me.gameWon, false, 'The Shadow loses on a unique plurality.');
    if (count === 4 || count === 6) assert.equal(sockets[shadowIndex].latestSnapshot.me.gameWon, true, 'The Shadow wins on a tied vote.');
    if (count === 3 || count === 5) assert(sockets.every((socket, index) => index === shadowIndex || socket.latestSnapshot.me.gameWon), 'Investigators win when the Shadow receives a unique plurality.');
    if (count === 4 || count === 6) assert(sockets.every((socket, index) => index === shadowIndex || !socket.latestSnapshot.me.gameWon), 'Investigators lose when the final vote is tied.');
    assert(sockets.every((socket) => socket.latestSnapshot.room.result.caseOutcome === sockets[0].latestSnapshot.room.result.caseOutcome), 'Every player sees the same factual case result.');
    if (count === 4) {
      const reconnectIndex = shadowIndex;
      sockets[reconnectIndex].disconnect();
      await pause(100);
      const reconnected = await connect(); trackSnapshots(reconnected); sockets[reconnectIndex] = reconnected;
      reconnected.emit('player:reconnect', sessions[reconnectIndex]);
      await waitForSnapshot(reconnected, ({ room }) => room.phase === 'ended', 'reconnected ending');
      assert.equal(reconnected.latestSnapshot.me.role, 'Shadow', 'Private role is restored after reconnect.');
      assert.equal(reconnected.latestSnapshot.me.gameWon, true, 'The personalized result survives reconnect.');
      assert.equal(reconnected.latestSnapshot.room.result.shadowName, reconnected.latestSnapshot.me.name, 'The final shared reveal matches the server role.');
    }
    if (count === 2) assert.equal(sockets[0].latestSnapshot.me.gameWon, coopCorrect, 'Both cooperative players receive the same correct or incorrect NPC result.');
    return `${count} players: passed (story cast, synchronization, full game, privacy)`;
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

const results = [await checkEveryCastCombination()];
for (const count of [2, 3, 4, 5, 6]) results.push(await runPlayerCount(count));
results.push(await runPlayerCount(2, false));
results[results.length - 1] = results[results.length - 1].replace('2 players:', '2-player incorrect accusation:');
console.log(results.join('\n'));
