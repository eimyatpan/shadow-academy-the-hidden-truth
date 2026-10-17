import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();
const allowedClientOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && allowedClientOrigins.length === 0) {
  throw new Error('CLIENT_ORIGIN must contain the allowed frontend origin(s) in production.');
}
const corsOrigin = allowedClientOrigins.length ? allowedClientOrigins : true;
app.use(cors({ origin: corsOrigin }));
app.get('/', (_req, res) => res.json({ name: 'Shadow Academy game server', status: 'online' }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: allowedClientOrigins.length ? allowedClientOrigins : '*', methods: ['GET', 'POST'] } });
const PORT = process.env.PORT || 3001;
const rooms = new Map();
const playerSockets = new Map();
const CHARACTER_IDS = ['aoi', 'ren', 'mika', 'haruto', 'yuna', 'sota'];
const STORY_DIALOGUE_BEAT_COUNT = 6;

const ROUND_OPTIONS = [
  [{ id: 'clock', icon: '◷', label: 'Inspect the stopped clock' }, { id: 'desk', icon: '▤', label: 'Search the librarian’s desk' }, { id: 'window', icon: '◇', label: 'Examine the archive window' }],
  [{ id: 'corridor', icon: '⌁', label: 'Follow the wet footprints' }, { id: 'witness', icon: '◉', label: 'Question the night guard' }, { id: 'bell', icon: '♧', label: 'Check the bell tower' }],
  [{ id: 'ledger', icon: '▧', label: 'Read the archive ledger' }, { id: 'ink', icon: '✎', label: 'Test the fresh ink' }, { id: 'passage', icon: '⌂', label: 'Search the hidden passage' }]
];
const PRIVATE_CLUES = [
  [
    { title: 'A Dustless Outline', text: 'The missing document left a clean rectangle in the dust. Whatever took it was carried flat, not rolled.' },
    { title: 'A Brass Thread', text: 'A fine brass-coloured thread is caught on the archive latch. It matches the trim on an old staff uniform.' },
    { title: 'The Clock’s Secret', text: 'The clock stopped at 12:07, but its minute hand was pushed backward. Someone wanted the time to look exact.' },
    { title: 'A Scent of Rain', text: 'The archive smells faintly of rainwater, though every window is latched from the inside.' },
    { title: 'Fresh Wax', text: 'A drop of sealing wax is still soft beneath the desk. The document’s seal was opened carefully.' },
    { title: 'A Familiar Key', text: 'A polished keyhole has no scratches. Whoever opened the archive used an authorised key.' }
  ],
  [
    { title: 'Two Sets of Footsteps', text: 'One trail is damp. A second, almost invisible trail approaches from the dry west corridor.' },
    { title: 'The Guard’s Note', text: 'The night guard wrote “bell at twelve” before the tower rang. The note’s ink is the same blue as the library ledger.' },
    { title: 'A Broken Umbrella', text: 'A broken umbrella is hidden behind the east stairwell. Its handle bears the academy library crest.' },
    { title: 'The Wrong Direction', text: 'The footprints point toward the archive, but the mud was pressed into the floor from the opposite direction.' },
    { title: 'A Witness Remembers', text: 'A student saw a lantern near the archive before midnight. The lantern was carried by someone wearing gloves.' },
    { title: 'A Bell Without Sound', text: 'The bell rope is frayed, but the fibres are clean. It has not been pulled in several days.' }
  ],
  [
    { title: 'The Ledger Entry', text: 'A staff access entry was erased at 11:52. The pressure of the pen left an imprint: “Kisaragi”.' },
    { title: 'Ink from the Tower', text: 'The fresh ink contains powdered silver used only in the head librarian’s restoration room.' },
    { title: 'The Hidden Passage', text: 'A narrow passage connects the restoration room to the archive. Its inner latch can only be opened with a staff key.' },
    { title: 'A Torn Sleeve', text: 'A dark sleeve fibre is caught in the passage hinge. The head librarian’s uniform has a fresh tear.' },
    { title: 'The Original Seal', text: 'The original seal is hidden behind a loose stone. The document itself is nowhere nearby.' },
    { title: 'A Note in the Margin', text: 'The ledger margin reads: “The truth must stay buried until the eclipse.” The handwriting is formal and deliberate.' }
  ]
];
const PUBLIC_CLUES = [
  { id: 'public-1', title: 'SHARED EVIDENCE · THE ARCHIVE', text: 'The archive door was unlocked with a staff key. There are no signs of forced entry.' },
  { id: 'public-2', title: 'SHARED EVIDENCE · THE EAST CORRIDOR', text: 'The wet footprints begin inside the corridor, not outside the school. The rain trail may have been staged.' },
  { id: 'public-3', title: 'SHARED EVIDENCE · THE RESTORATION ROOM', text: 'A hidden passage links the restoration room to the archive. Only senior library staff know it exists.' }
];
const TWO_PLAYER_SUSPECTS = ['Head Librarian Kisaragi', 'Night Guard Mori', 'Archive Assistant Sora'];
const ROUND_TIME_LIMIT_MS = Math.max(250, Number(process.env.ROUND_TIME_LIMIT_MS) || 90_000);
const VOTE_TIME_LIMIT_MS = Math.max(250, Number(process.env.VOTE_TIME_LIMIT_MS) || 60_000);
const QUESTION_PROMPTS = [
  'Which part of the timeline can you verify?',
  'What do you make of the staged footprints?',
  'How does the archive access evidence fit your theory?'
];
const PLAYER_RESPONSES = [
  { id: 'key-access', label: 'The staff-key and access records point to someone with library access.' },
  { id: 'window-entry', label: 'I think someone entered through the archive window.' },
  { id: 'wet-trail', label: 'The wet footprints look like a genuine trail from outside.' },
  { id: 'withhold', label: 'I want to hold my theory until I compare more evidence.' },
  { id: 'pass', label: 'Pass — I have no statement to add.' }
];
const LEAD_EVIDENCE = {
  clock: { title: '12:07 Was Set by Hand', text: 'The archive clock and tower clock were both stopped deliberately. Neither timestamp proves when the document was taken.', tags: ['clock-faked'], reliability: 'VERIFIED MECHANISM', explanation: 'The clock time is a planted alibi, so use the access record instead of trusting 12:07.' },
  desk: { title: 'Authorized Key, No Forced Entry', text: 'The desk key fits the archive lock cleanly. The door and frame show no force marks.', tags: ['authorized-access'], reliability: 'PHYSICAL TRACE', explanation: 'The thief had an authorized key; this supports an insider route.' },
  window: { title: 'Window Entry Ruled Out', text: 'Dust and latch fibers are undisturbed on the inside of the window.', tags: ['window-ruled-out'], reliability: 'PHYSICAL TRACE', explanation: 'The window theory conflicts with the intact inner latch.' },
  corridor: { title: 'The Wet Trail Was Staged', text: 'The damp prints were pressed into the floor from the wrong direction. A dry second trail approaches from the west hall.', tags: ['footprints-staged'], reliability: 'PHYSICAL TRACE', explanation: 'The visible trail was arranged to suggest an outside intruder.' },
  witness: { title: 'A Witness Saw a Covered Lantern', text: 'A night guard remembers a covered lantern near the archive before the recorded 12:07 stop; the witness cannot identify who carried it.', tags: ['lantern-before-1207'], reliability: 'WITNESS · PARTIAL', explanation: 'The activity began before the clock time, but the witness does not identify a student.' },
  bell: { title: 'The Bell Could Not Have Rung', text: 'Clean fibers show the bell rope had not moved for days, despite the guard’s note claiming a midnight chime.', tags: ['bell-staged'], reliability: 'PHYSICAL TRACE', explanation: 'The bell story was another false time marker.' },
  ledger: { title: 'The Erased Access Entry', text: 'At 11:52 a staff access line was scraped from the ledger. Its pen indentation reads “Kisaragi”.', tags: ['kisaragi-access'], reliability: 'DOCUMENT · VERIFIED IMPRESSION', explanation: 'This places Head Librarian Kisaragi at the restricted archive before the false 12:07 timestamp.' },
  ink: { title: 'Restoration Silver in Fresh Ink', text: 'The ink on the altered record contains silver powder kept only in the head librarian’s restoration room.', tags: ['restoration-ink'], reliability: 'MATERIAL MATCH', explanation: 'The altered record connects the cover-up to the restoration room.' },
  passage: { title: 'The Staff Passage', text: 'A concealed latch links the restoration room to the archive; it requires a senior staff key.', tags: ['staff-passage'], reliability: 'ARCHITECTURAL TRACE', explanation: 'The passage gives the thief a route that bypasses the corridor and its staged prints.' }
};
const MANDATORY_EVIDENCE = [
  { id: 'mandatory-1', title: 'The Document Was Carried Flat; the Window Was Not Used', text: 'The dust outline shows the sealed document was lifted from its stand without being rolled. The inner window latch is undisturbed, ruling out the apparent outside route.', tags: ['document-removed', 'window-ruled-out'], reliability: 'CORROBORATED PHYSICAL TRACE', explanation: 'The document was deliberately removed, and the window theory is contradicted by its intact inner latch.' },
  { id: 'mandatory-2', title: 'The Midnight Trail Conflicts', text: 'The wet prints point toward the archive, but their mud ridges were pressed from the opposite direction.', tags: ['footprints-staged'], reliability: 'PHYSICAL TRACE', explanation: 'The apparent outside route is unreliable; compare statements against the physical trail.' },
  { id: 'mandatory-3', title: 'The Record and Passage Converge', text: 'The erased 11:52 entry names Kisaragi, and the staff-only passage leads directly from his restoration room to the archive.', tags: ['kisaragi-access', 'staff-passage'], reliability: 'CORROBORATED', explanation: 'Two independent traces connect Kisaragi to the document’s route.' }
];
const CLUE_COMBINATIONS = [
  { id: 'false-time', requires: ['clock-faked', 'lantern-before-1207'], title: 'The 12:07 Alibi Falls Apart', text: 'Activity predates the staged clock time. The 12:07 reading cannot establish when the archive was entered.' },
  { id: 'staged-route', requires: ['footprints-staged', 'window-ruled-out'], title: 'The Intruder Route Was Staged', text: 'Neither the window nor the wet trail is a credible entry route. The apparent outside culprit is a misdirection.' },
  { id: 'kisaragi-chain', requires: ['kisaragi-access', 'staff-passage'], title: 'Kisaragi Had Access and a Hidden Route', text: 'The erased access impression and staff-only passage independently place Kisaragi on the document’s route.' },
  { id: 'restoration-chain', requires: ['restoration-ink', 'kisaragi-access'], title: 'The Record Was Altered from the Restoration Room', text: 'The silver ink and erased access entry connect the timeline cover-up to Kisaragi’s workroom.' }
];
const INVESTIGATION_SCENES = [
  { id: 'forbidden-library', title: 'The Forbidden Library', location: 'NORTH WING · ARCHIVE ROOM', background: '/assets/scenes/forbidden-library.webp', prompt: 'The archive was opened without force. Search the room for the trace the intruder left behind.', objects: [
    { id: 'archive-seal', label: 'Broken wax seal', x: 43, y: 55, title: 'A Second Impression', text: 'The wax was pressed twice. The second impression does not match the archive’s official seal.' },
    { id: 'desk-drawer', label: 'Librarian’s desk', x: 25, y: 68, title: 'An Authorized Key', text: 'The desk key turned cleanly. There are no scratches around the lock: the archive was opened with an authorized key.' },
    { id: 'window-latch', label: 'Stained-glass window', x: 64, y: 47, title: 'The Latched Window', text: 'Dust along the inner latch is undisturbed. No one entered or escaped through this window.' },
    { id: 'stopped-clock', label: 'Stopped clock', x: 78, y: 47, title: 'The Clock’s Secret', text: 'The clock stopped at 12:07, but its minute hand was pushed backward to make the time look exact.' },
    { id: 'visitor-ledger', label: 'Visitor ledger', x: 51, y: 71, title: 'A Missing Line', text: 'A line was scraped from the visitor ledger at 11:52. The pressure left a faint mark beneath the erased name.' },
    { id: 'velvet-stand', label: 'Empty document stand', x: 37, y: 82, title: 'A Dustless Outline', text: 'The missing document left a clean rectangle in the dust. It was carried flat, not rolled.' }
  ] },
  { id: 'moonlit-corridor', title: 'The Moonlit Corridor', location: 'EAST HALL · AFTER MIDNIGHT', background: '/assets/scenes/moonlit-corridor.webp', prompt: 'The wet trail may have been staged. Compare the footprints with the corridor’s other signs.', objects: [
    { id: 'wet-footprints', label: 'Wet footprints', x: 56, y: 77, title: 'Two Sets of Footsteps', text: 'One trail is damp. A second, almost invisible trail approaches from the dry west corridor.' },
    { id: 'glass-lantern', label: 'Abandoned lantern', x: 39, y: 57, title: 'A Lantern at Midnight', text: 'The lantern wick is cold, though a witness saw it burning near the archive before midnight.' },
    { id: 'broken-umbrella', label: 'Broken umbrella', x: 17, y: 78, title: 'The Broken Umbrella', text: 'The umbrella is dry inside. Its handle bears the academy library crest.' },
    { id: 'guard-note', label: 'Guard’s note', x: 72, y: 58, title: 'The Guard’s Note', text: 'The night guard wrote “bell at twelve” before the tower rang. The ink matches the library ledger.' },
    { id: 'bell-cord', label: 'Bell cord', x: 84, y: 41, title: 'A Bell Without Sound', text: 'The bell rope is frayed, but its fibres are clean. It has not been pulled in several days.' },
    { id: 'mud-print', label: 'Mud by the stair', x: 48, y: 88, title: 'The Wrong Direction', text: 'The prints point toward the archive, but the mud was pressed into the floor from the opposite direction.' }
  ] },
  { id: 'clock-tower', title: 'The Clock Tower', location: 'UPPER SPIRE · STAFF ACCESS ONLY', background: '/assets/scenes/clock-tower.webp', prompt: 'The tower’s mechanism stopped at the same minute as the archive clock. Find what connects the two.', objects: [
    { id: 'silver-ink', label: 'Silver ink vial', x: 75, y: 73, title: 'Ink from the Tower', text: 'The fresh ink contains powdered silver used only in the head librarian’s restoration room.' },
    { id: 'tower-gears', label: 'Clockwork gears', x: 22, y: 46, title: 'A Clock Stopped by Hand', text: 'A gear tooth is wedged with a strip of paper. The mechanism was stopped deliberately, not by age.' },
    { id: 'loose-stone', label: 'Loose stone', x: 63, y: 79, title: 'The Original Seal', text: 'Behind a loose stone lies the document’s original wax seal. The document itself has already been moved.' },
    { id: 'tower-ledger', label: 'Tower ledger', x: 80, y: 60, title: 'The Ledger Entry', text: 'A staff access entry was erased at 11:52. Its indentation reads “Kisaragi”.' },
    { id: 'brass-thread', label: 'Brass thread', x: 42, y: 68, title: 'A Brass Thread', text: 'A brass-coloured thread is caught in the stair rail. It matches the trim on an old staff uniform.' },
    { id: 'hidden-latch', label: 'Hidden latch', x: 52, y: 52, title: 'The Hidden Passage', text: 'A concealed latch opens a narrow passage between the tower and the restoration room. It needs a staff key.' }
  ] }
];

const SCENE_EVIDENCE = {
  'archive-seal': { tags: ['seal-opened'], reliability: 'PHYSICAL TRACE', explanation: 'A second impression means the document seal was opened before the archive was searched.', timestamp: 'AFTER 11:52 PM' },
  'desk-drawer': { tags: ['authorized-access'], reliability: 'PHYSICAL TRACE', explanation: 'A clean key turn and an intact lock indicate authorized access.', timestamp: 'ARCHIVE ENTRY' },
  'window-latch': { tags: ['window-ruled-out'], reliability: 'PHYSICAL TRACE', explanation: 'Undisturbed dust rules out the window as an entry or exit route.', timestamp: 'AFTER THE THEFT' },
  'stopped-clock': { tags: ['clock-faked'], reliability: 'MECHANISM TEST', explanation: 'The minute hand was moved backward, so 12:07 is not a trustworthy time.', timestamp: '12:07 AM · FALSE' },
  'visitor-ledger': { tags: ['kisaragi-access'], reliability: 'DOCUMENT IMPRESSION', explanation: 'The erased line preserves the pressure pattern of a name and time.', timestamp: '11:52 PM' },
  'velvet-stand': { tags: ['document-removed'], reliability: 'PHYSICAL TRACE', explanation: 'The clean outline shows the document was removed flat.', timestamp: 'AFTER 11:52 PM' },
  'wet-footprints': { tags: ['footprints-staged'], reliability: 'PHYSICAL TRACE', explanation: 'The direction of the pressed mud contradicts the apparent route.', timestamp: 'CORRIDOR · AFTER MIDNIGHT' },
  'glass-lantern': { tags: ['lantern-before-1207'], reliability: 'WITNESS CORROBORATION', explanation: 'A cold wick is consistent with the lantern being used before the false clock time.', timestamp: 'BEFORE 12:07 AM' },
  'broken-umbrella': { tags: ['footprints-staged'], reliability: 'PHYSICAL TRACE', explanation: 'The inside is dry, so it could not have made the wet trail.', timestamp: 'CORRIDOR · AFTER MIDNIGHT' },
  'guard-note': { tags: ['bell-staged'], reliability: 'DOCUMENT COMPARISON', explanation: 'The note predicts a bell that the clean rope shows was never pulled.', timestamp: 'WRITTEN BEFORE MIDNIGHT' },
  'bell-cord': { tags: ['bell-staged'], reliability: 'PHYSICAL TRACE', explanation: 'Clean fibers show the bell was not rung when the note claims.', timestamp: 'SEVERAL DAYS UNUSED' },
  'mud-print': { tags: ['footprints-staged'], reliability: 'PHYSICAL TRACE', explanation: 'The pressure direction reverses the apparent trail.', timestamp: 'CORRIDOR · AFTER MIDNIGHT' },
  'silver-ink': { tags: ['restoration-ink'], reliability: 'MATERIAL MATCH', explanation: 'Only the restoration room stores this silver-powder ink.', timestamp: 'ALTERED RECORD' },
  'tower-gears': { tags: ['clock-faked'], reliability: 'MECHANISM TEST', explanation: 'A paper strip stopped the clockwork by hand.', timestamp: '12:07 AM · FALSE' },
  'loose-stone': { tags: ['seal-opened'], reliability: 'PHYSICAL TRACE', explanation: 'The original seal was hidden after the document had already been moved.', timestamp: 'AFTER THE THEFT' },
  'tower-ledger': { tags: ['kisaragi-access'], reliability: 'DOCUMENT IMPRESSION', explanation: 'The erased access line preserves Kisaragi’s name.', timestamp: '11:52 PM' },
  'brass-thread': { tags: ['staff-access'], reliability: 'TRACE · NON-IDENTIFYING', explanation: 'The thread is consistent with a staff uniform, but cannot identify a particular person.', timestamp: 'CORRIDOR' },
  'hidden-latch': { tags: ['staff-passage'], reliability: 'ARCHITECTURAL TRACE', explanation: 'The hidden route opens with a senior staff key.', timestamp: 'RESTORATION ROOM ↔ ARCHIVE' }
};
const DECOY_CLUE = { id: 'shadow-decoy', title: 'A Possible Window Entry', text: 'A faint smear on the outer sill may indicate that the thief entered through the archive window.', tags: ['window-entry-claim'], reliability: 'UNVERIFIED TRACE', explanation: 'This single smear has not been corroborated. Compare it with the inner latch evidence.', challengeTag: 'window-entry', timestamp: 'BEFORE 12:07 AM', optional: true, decoy: true };
const STATEMENT_CLAIMS = {
  'key-access': { text: PLAYER_RESPONSES[0].label, tags: ['supports-authorized-access'] },
  'window-entry': { text: PLAYER_RESPONSES[1].label, tags: ['window-entry-claim'] },
  'wet-trail': { text: PLAYER_RESPONSES[2].label, tags: ['wet-trail-claim'] },
  withhold: { text: PLAYER_RESPONSES[3].label, tags: [] },
  pass: { text: PLAYER_RESPONSES[4].label, tags: [] }
};

function safeName(value) { return String(value || '').trim().replace(/[<>]/g, '').slice(0, 18); }
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
  return code;
}
function roomFor(socket, data) { const code = String(data?.code || '').toUpperCase(); return rooms.get(code); }
function roomOfPlayer(player) { return rooms.get(player?.roomCode); }
function attachPlayer(socket, room, player) {
  player.socketId = socket.id; player.roomCode = room.code; player.online = true;
  playerSockets.set(socket.id, { roomCode: room.code, playerId: player.id });
  socket.join(room.code);
}
function sessionFor(room, player) { return { code: room.code, playerId: player.id, token: player.token }; }
function visibleClues(room) { return room.publicClues.filter((clue) => !room.hiddenClueId || clue.id !== room.hiddenClueId); }
function resolveCombinations(room) {
  const known = new Set(room.publicClues.flatMap((clue) => clue.tags || []));
  for (const combo of CLUE_COMBINATIONS) {
    if (!room.conclusions.some((clue) => clue.id === combo.id) && combo.requires.every((tag) => known.has(tag))) {
      room.conclusions.push({ ...combo, source: 'deduction', reliability: 'CORROBORATED DEDUCTION' });
    }
  }
  reconcileStatements(room);
}
function reconcileStatements(room) {
  const known = new Set(room.publicClues.flatMap((clue) => clue.tags || []));
  for (const statement of room.statements || []) {
    if (statement.responseId === 'window-entry' && known.has('window-ruled-out')) {
      statement.contradicted = true; statement.contradiction = 'Conflicts with the undisturbed inner window latch.';
    } else if (statement.responseId === 'wet-trail' && known.has('footprints-staged')) {
      statement.contradicted = true; statement.contradiction = 'Conflicts with the reversed mud pressure.';
    }
  }
}
function makeSharedClue(clue, details = {}) {
  return { ...clue, id: clue.id || crypto.randomUUID(), source: 'lead', round: details.round, lead: details.lead, tags: clue.tags || [], timestamp: clue.timestamp || 'CASE TIMELINE', optional: clue.optional !== false, ...details };
}
function publicRoom(room, viewer) {
  const result = {
    code: room.code, hostId: room.hostId, phase: room.phase, round: room.round,
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, online: p.online, characterId: p.characterId })),
    activeStoryCast: room.phase === 'lobby' ? [] : (room.activeStoryCast || []).slice(),
    storyDialogueIndex: room.storyDialogueIndex || 0,
    chat: room.chat.slice(-80), publicClues: visibleClues(room).map(({ decoy, challengeTag, ...clue }) => ({ ...clue, challengeAvailable: Boolean(decoy && !clue.challenged) })), conclusions: room.conclusions,
    statements: room.statements, question: room.question ? { ...room.question, responses: undefined } : null,
    questionPrompts: room.phase === 'investigation' ? QUESTION_PROMPTS : [], responseOptions: room.phase === 'investigation' && room.question?.targetId === viewer?.id ? PLAYER_RESPONSES : [],
    submitted: room.submitted.map((id) => id), options: room.phase === 'investigation' ? ROUND_OPTIONS[room.round - 1] : [],
    roleConfirmationCount: room.players.filter((p) => p.online && room.roleConfirmations?.has(p.id)).length,
    connectedPlayerCount: room.players.filter((p) => p.online).length,
    introProgress: room.players.filter((p) => p.online && p.introComplete).length,
    introConnectedCount: room.players.filter((p) => p.online).length,
    inspected: (room.inspected || []).slice(), foundObjects: (room.foundObjects || []).slice(),
    roundDeadline: room.phase === 'investigation' ? room.roundDeadline : null,
    voteDeadline: room.phase === 'voting' ? room.voteDeadline : null,
    scene: room.phase === 'investigation' ? { ...INVESTIGATION_SCENES[room.round - 1], objects: INVESTIGATION_SCENES[room.round - 1].objects.map(({ id, label, x, y }) => ({ id, label, x, y })) } : null,
    result: room.result
  };
  if (room.phase === 'voting') { result.voteCount = Object.keys(room.votes).length; result.votingPlayers = room.players.length; }
  if (viewer) {
    result.myClues = ['investigation', 'voting', 'ended'].includes(room.phase) ? viewer.privateClues.slice(0, Math.min(room.round, viewer.privateClues.length)).map((clue, index) => ({ ...clue, round: index + 1 })) : [];
    result.myVote = room.votes[viewer.id] || null;
    result.myDeception = viewer.role === 'Shadow' && room.phase !== 'lobby' ? { used: room.shadowActionUsed, action: room.shadowActionUsed ? room.shadowActionType : null, available: !room.shadowActionUsed && room.phase === 'investigation' } : null;
    result.myQuestion = room.question?.targetId === viewer.id ? { id: room.question.id, prompt: room.question.prompt } : null;
    result.ready = viewer.ready;
    result.characterId = viewer.characterId;
    if (room.players.length === 2 && room.phase === 'voting') result.npcSuspects = TWO_PLAYER_SUSPECTS;
  }
  return result;
}
function snapshot(player) {
  const room = roomOfPlayer(player);
  if (!room) return;
  const socket = io.sockets.sockets.get(player.socketId);
  const gameWon = room.phase === 'ended' && room.result
    ? (player.role === 'Shadow' ? !room.result.investigatorsWon : room.result.investigatorsWon)
    : null;
  if (socket) socket.emit('room:snapshot', { room: publicRoom(room, player), me: { id: player.id, name: player.name, ready: player.ready, characterId: player.characterId, role: room.phase === 'lobby' ? null : player.role, roleConfirmed: room.roleConfirmations?.has(player.id) || false, introComplete: player.introComplete || false, gameWon, myClues: ['investigation', 'voting', 'ended'].includes(room.phase) ? player.privateClues.slice(0, Math.min(room.round, player.privateClues.length)) : [] } });
}
function broadcast(room) { for (const player of room.players) snapshot(player); }
function systemChat(room, text) {
  room.chat.push({ id: crypto.randomUUID(), name: 'Academy System', text, at: Date.now(), system: true });
  room.chat = room.chat.slice(-100);
}
function announce(room, text) { systemChat(room, text); broadcast(room); }
function replyError(ack, error) { if (typeof ack === 'function') ack({ ok: false, error }); }
function replyOk(ack, extra = {}) { if (typeof ack === 'function') ack({ ok: true, ...extra }); }
function getPlayer(socket) {
  const link = playerSockets.get(socket.id);
  const room = link && rooms.get(link.roomCode);
  return room ? { room, player: room.players.find((p) => p.id === link.playerId) } : {};
}
function choosePrivateClues() {
  return PRIVATE_CLUES.map((roundClues, index) => {
    const clue = roundClues[crypto.randomInt(roundClues.length)];
    return { ...clue, id: `private-${index + 1}-${crypto.randomUUID()}`, timestamp: ['11:52 PM', 'BEFORE 12:07 AM', 'AFTER THE THEFT'][index], reliability: 'PRIVATE FIELD NOTE', explanation: 'A private observation. Share it with the team if you choose; it is not visible to other players automatically.', tags: ['private-observation'] };
  });
}
function startGame(room) {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.phase = 'roleReveal'; room.round = 1; room.publicClues = []; room.conclusions = []; room.statements = []; room.question = null; room.questionUses = new Set(); room.submitted = []; room.choices = {}; room.votes = {}; room.roleConfirmations = new Set(); room.inspected = []; room.foundObjects = []; room.inspections = {}; room.roundDeadline = null; room.voteDeadline = null; room.result = null; room.hiddenClueId = null; room.hiddenClueRestoreRound = null; room.shadowActionUsed = false; room.shadowActionType = null; room.shadowActionClueId = null;
  room.activeStoryCast = room.players.map((player) => player.characterId);
  room.storyDialogueIndex = 0;
  room.players.forEach((p) => { p.privateClues = choosePrivateClues(); p.role = 'Investigator'; p.introComplete = false; });
  if (room.players.length >= 3) {
    room.players[crypto.randomInt(room.players.length)].role = 'Shadow';
    const motivations = ['Kisaragi promised to preserve the student’s family scholarship if the archive stayed closed.', 'Kisaragi claimed the document would expose a relative’s old mistake and asked for one night of protection.', 'Kisaragi offered to erase a disciplinary record in exchange for delaying the investigation.'];
    room.shadowMotivation = motivations[crypto.randomInt(motivations.length)];
  } else room.shadowMotivation = null;
  announce(room, 'Secret roles assigned. Read your private mission and confirm when you are ready.');
}
function advanceRoleReveal(room) {
  if (room.phase !== 'roleReveal') return;
  const connected = room.players.filter((p) => p.online);
  if (!connected.length || !connected.every((p) => room.roleConfirmations.has(p.id))) return;
  room.phase = 'storyIntro';
  announce(room, 'The sealed archive is open. The midnight investigation begins.');
}
function advanceStoryIntro(room) {
  if (room.phase !== 'storyIntro') return;
  const connected = room.players.filter((p) => p.online);
  if (!connected.length || !connected.every((p) => p.introComplete)) return;
  room.round = 1;
  startInvestigationRound(room);
  announce(room, room.players.length === 2 ? 'Round one begins. Work together to identify the NPC culprit.' : 'Round one begins. Compare evidence, and protect your suspicions.');
}
function startInvestigationRound(room) {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  if (room.voteTimer) clearTimeout(room.voteTimer);
  if (room.hiddenClueId && room.hiddenClueRestoreRound <= room.round) { room.hiddenClueId = null; room.hiddenClueRestoreRound = null; systemChat(room, 'A temporarily obscured optional record is available again.'); }
  room.phase = 'investigation';
  room.inspected = []; room.foundObjects = []; room.inspections = {}; room.submitted = []; room.choices = {}; room.question = null; room.questionUses = new Set();
  room.roundDeadline = Date.now() + ROUND_TIME_LIMIT_MS;
  const round = room.round;
  room.roundTimer = setTimeout(() => {
    if (room.phase !== 'investigation' || room.round !== round) return;
    const firstOptionId = ROUND_OPTIONS[round - 1][0].id;
    for (const player of room.players.filter((p) => p.online)) {
      if (!room.inspected.includes(player.id)) room.inspected.push(player.id);
      if (!room.submitted.includes(player.id)) { room.choices[player.id] = firstOptionId; room.submitted.push(player.id); }
    }
    systemChat(room, `Round ${round} time has ended. Unsubmitted leads were recorded automatically.`);
    finishRound(room);
  }, ROUND_TIME_LIMIT_MS);
  room.roundTimer.unref?.();
}
function maybeFinishRound(room) {
  if (room.phase !== 'investigation') return;
  const connected = room.players.filter((p) => p.online);
  if (!connected.length) return;
  if (connected.every((p) => room.inspected.includes(p.id) && room.submitted.includes(p.id))) finishRound(room);
}
function finishRound(room) {
  if (room.phase !== 'investigation') return;
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = null; room.roundDeadline = null;
  const tallies = {};
  for (const optionId of Object.values(room.choices)) tallies[optionId] = (tallies[optionId] || 0) + 1;
  const options = ROUND_OPTIONS[room.round - 1];
  const topCount = Math.max(0, ...Object.values(tallies));
  const tied = options.filter((o) => tallies[o.id] === topCount);
  const chosen = (tied.length ? tied : [options[0]])[crypto.randomInt(tied.length || 1)];
  const leadClue = LEAD_EVIDENCE[chosen.id];
  room.publicClues.push(makeSharedClue({ ...leadClue, id: `lead-${room.round}-${chosen.id}`, source: 'group lead' }, { round: room.round, lead: chosen.id, title: `GROUP LEAD · ${leadClue.title}`, timestamp: ['BEFORE 12:07 AM', 'AFTER MIDNIGHT', '11:52 PM'][room.round - 1] }));
  room.publicClues.push(makeSharedClue({ ...MANDATORY_EVIDENCE[room.round - 1], id: `mandatory-${room.round}`, source: 'case requirement' }, { round: room.round, timestamp: ['AFTER 11:52 PM', 'AFTER MIDNIGHT', '11:52 PM'][room.round - 1] }));
  resolveCombinations(room);
  room.inspected = []; room.foundObjects = []; room.inspections = {}; room.submitted = []; room.choices = {};
  if (room.round >= 3) {
    room.phase = 'voting'; room.voteDeadline = Date.now() + VOTE_TIME_LIMIT_MS;
    room.voteTimer = setTimeout(() => {
      if (room.phase !== 'voting') return;
      for (const player of room.players) if (!(player.id in room.votes)) room.votes[player.id] = 'ABSTAIN';
      systemChat(room, 'Voting time expired. Remaining votes were recorded as abstentions.'); finishVote(room);
    }, VOTE_TIME_LIMIT_MS); room.voteTimer.unref?.();
    announce(room, `All three investigation rounds are complete. ${room.players.length === 2 ? 'Accuse Head Librarian Kisaragi or abstain.' : 'Vote for the student protecting Kisaragi or abstain.'}`);
  }
  else { room.round += 1; startInvestigationRound(room); announce(room, `The group follows “${chosen.label}”. Round ${room.round} begins at ${INVESTIGATION_SCENES[room.round - 1].title}.`); }
}
function finishVote(room) {
  if (room.voteTimer) clearTimeout(room.voteTimer);
  room.voteTimer = null; room.voteDeadline = null;
  if (room.players.length === 2) {
    const counts = {}; for (const vote of Object.values(room.votes)) if (vote !== 'ABSTAIN') counts[vote] = (counts[vote] || 0) + 1;
    const top = Math.max(0, ...Object.values(counts)); const winners = Object.keys(counts).filter((name) => counts[name] === top && top > 0);
    const culprit = 'Head Librarian Kisaragi';
    const investigatorsWon = winners.length === 1 && winners[0] === culprit && counts[culprit] === 2;
    const accusedNames = winners.filter((name) => TWO_PLAYER_SUSPECTS.includes(name));
    room.result = { investigatorsWon, culpritName: culprit, culpritRole: 'DOCUMENT THIEF · NPC', thiefName: culprit, shadowName: null, accusedNames, caseOutcome: investigatorsWon ? 'KISARAGI IDENTIFIED · DOCUMENT RECOVERED' : 'KISARAGI NOT IDENTIFIED', title: investigatorsWon ? 'The archive is unsealed.' : 'The mystery remains.', text: investigatorsWon ? 'The erased 11:52 record, restoration ink, and hidden passage converge on Head Librarian Kisaragi. The investigators recover the sealed document.' : 'The evidence was not enough to expose the thief. At dawn, the document is still missing.' , explanation: 'In cooperative mode there is no student Shadow. Head Librarian Kisaragi stole the document using his staff key and the passage from the restoration room.' , importantClues: room.publicClues.filter((clue) => clue.source !== 'shadow').map(({ title }) => title), deception: null };
  } else {
    const counts = {}; for (const vote of Object.values(room.votes)) if (vote && vote !== 'ABSTAIN') counts[vote] = (counts[vote] || 0) + 1;
    const top = Math.max(0, ...Object.values(counts)); const leaders = Object.keys(counts).filter((id) => counts[id] === top && top > 0);
    const pickedId = leaders.length === 1 ? leaders[0] : null;
    const shadow = room.players.find((p) => p.role === 'Shadow');
    const investigatorsWon = Boolean(pickedId && pickedId === shadow?.id);
    const accusedNames = leaders.map((id) => room.players.find((p) => p.id === id)?.name).filter(Boolean);
    const shadowName = shadow?.name || 'Unknown';
    const motivation = room.shadowMotivation || 'Kisaragi promised to protect the student’s family scholarship if the document remained hidden.';
    const deception = room.shadowActionUsed ? { type: room.shadowActionType, clue: room.publicClues.find((clue) => clue.id === room.shadowActionClueId)?.title || 'Optional evidence', challenged: Boolean(room.publicClues.find((clue) => clue.id === room.shadowActionClueId)?.challenged) } : null;
    room.result = { investigatorsWon, culpritName: shadowName, culpritRole: 'STUDENT SHADOW', thiefName: 'Head Librarian Kisaragi', shadowName, shadowCharacterId: shadow?.characterId, accusedNames, accusedName: accusedNames.join(', ') || 'No accusation', shadowEscaped: !investigatorsWon, caseOutcome: investigatorsWon ? 'SHADOW IDENTIFIED · KISARAGI EXPOSED' : leaders.length > 1 ? 'TIED VOTE · SHADOW ESCAPED' : 'SHADOW ESCAPED · KISARAGI PROTECTED', title: investigatorsWon ? 'The Shadow is unmasked.' : leaders.length > 1 ? 'No one is convicted.' : 'The Shadow escapes.', text: investigatorsWon ? `${shadowName} was correctly identified. The student’s cover is broken, and Kisaragi’s theft is exposed.` : leaders.length > 1 ? 'The final vote was tied. With no conviction, the Shadow slips away and Kisaragi keeps the document.' : `${accusedNames[0] || 'No student'} was not identified as the Shadow. Kisaragi’s accomplice escapes into the night.`, explanation: `Head Librarian Kisaragi stole the sealed document through the restoration passage. ${shadowName} secretly protected him because ${motivation.toLowerCase()} The Shadow’s identity depended on player choices and discussion, not character identity or scripted behavior.`, importantClues: room.publicClues.filter((clue) => !clue.decoy).map(({ title }) => title), deception };
  }
  if (room.hiddenClueId) { room.hiddenClueId = null; room.hiddenClueRestoreRound = null; }
  room.phase = 'ended'; announce(room, room.result.title);
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name } = {}, ack) => {
    const clean = safeName(name); if (!clean) return replyError(ack, 'Enter your academy name first.');
    const code = makeCode(); const player = { id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex'), name: clean, ready: true, online: true, characterId: null, privateClues: [], role: null, introComplete: false };
    const room = { code, hostId: player.id, phase: 'lobby', round: 0, players: [player], chat: [], publicClues: [], conclusions: [], statements: [], question: null, questionUses: new Set(), submitted: [], choices: {}, votes: {}, roleConfirmations: new Set(), inspected: [], foundObjects: [], inspections: {}, roundDeadline: null, voteDeadline: null, roundTimer: null, voteTimer: null, result: null, activeStoryCast: [], storyDialogueIndex: 0, shadowActionUsed: false, shadowActionType: null, shadowActionClueId: null, disconnectTimers: new Map() };
    rooms.set(code, room); attachPlayer(socket, room, player); broadcast(room);
    replyOk(ack, { session: sessionFor(room, player), room: publicRoom(room, player), me: { id: player.id, name: player.name, ready: player.ready, characterId: player.characterId } });
  });
  socket.on('room:join', ({ name, code } = {}, ack) => {
    const clean = safeName(name); const room = rooms.get(String(code || '').toUpperCase());
    if (!clean) return replyError(ack, 'Enter your academy name first.');
    if (!room) return replyError(ack, 'That room code was not found. Check it and try again.');
    if (room.phase !== 'lobby') return replyError(ack, 'This investigation has already started.');
    if (room.players.length >= 6) return replyError(ack, 'This room already has six players.');
    if (room.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return replyError(ack, 'That name is already being used in this room.');
    const player = { id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex'), name: clean, ready: false, online: true, characterId: null, privateClues: [], role: null, introComplete: false };
    room.players.push(player); attachPlayer(socket, room, player); systemChat(room, `${clean} joined the investigation.`); broadcast(room);
    replyOk(ack, { session: sessionFor(room, player), room: publicRoom(room, player), me: { id: player.id, name: player.name, ready: player.ready, characterId: player.characterId } });
  });
  socket.on('player:reconnect', (session) => {
    const room = rooms.get(String(session?.code || '').toUpperCase());
    const player = room?.players.find((p) => p.id === session?.playerId && p.token === session?.token);
    if (!room || !player) return socket.emit('game:error', { message: 'Your saved room session has expired. Create or join a room to start again.' });
    const timer = room.disconnectTimers.get(player.id); if (timer) { clearTimeout(timer); room.disconnectTimers.delete(player.id); }
    attachPlayer(socket, room, player); player.online = true; systemChat(room, `${player.name} reconnected.`); advanceRoleReveal(room); advanceStoryIntro(room); maybeFinishRound(room); broadcast(room);
  });
  socket.on('player:ready', ({ ready } = {}, ack) => {
    const { room, player } = getPlayer(socket); if (!room || !player || room.phase !== 'lobby') return replyError(ack, 'You cannot change ready status now.');
    player.ready = Boolean(ready); broadcast(room); replyOk(ack);
  });
  socket.on('player:character', ({ characterId } = {}, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || room.phase !== 'lobby') return replyError(ack, 'Characters can only be changed in the lobby.');
    if (!CHARACTER_IDS.includes(characterId)) return replyError(ack, 'That academy character is not available.');
    if (room.players.some((p) => p.id !== player.id && p.characterId === characterId)) return replyError(ack, 'Another student has already chosen that character.');
    player.characterId = characterId;
    broadcast(room);
    replyOk(ack);
  });
  socket.on('game:start', (_data, ack) => {
    const { room, player } = getPlayer(socket); if (!room || !player) return replyError(ack, 'Join a room first.');
    if (player.id !== room.hostId) return replyError(ack, 'Only the host can start the investigation.');
    if (room.phase !== 'lobby') return replyError(ack, 'This room has already started.');
    if (room.players.length < 2 || room.players.length > 6) return replyError(ack, 'The investigation needs 2–6 players.');
    if (room.players.some((p) => !CHARACTER_IDS.includes(p.characterId))) return replyError(ack, 'Every student must choose a character before the investigation starts.');
    if (new Set(room.players.map((p) => p.characterId)).size !== room.players.length) return replyError(ack, 'Each student needs a different character.');
    if (!room.players.every((p) => p.ready && p.online)) return replyError(ack, 'Everyone must be connected and ready.');
    startGame(room); replyOk(ack);
  });
  socket.on('player:confirm-role', (_data, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || room.phase !== 'roleReveal') return replyError(ack, 'There is no role reveal to confirm.');
    if (!player.online) return replyError(ack, 'Reconnect before confirming your role.');
    room.roleConfirmations.add(player.id);
    advanceRoleReveal(room);
    if (room.phase === 'roleReveal') broadcast(room);
    replyOk(ack);
  });
  socket.on('story:intro-complete', (_data, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || !['storyIntro', 'investigation'].includes(room.phase)) return replyError(ack, 'The opening scene is not active.');
    player.introComplete = true;
    if (room.phase === 'storyIntro') advanceStoryIntro(room);
    if (room.phase === 'storyIntro' || room.phase === 'investigation') broadcast(room);
    replyOk(ack);
  });
  socket.on('story:dialogue-advance', ({ fromIndex } = {}, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || room.phase !== 'storyIntro') return replyError(ack, 'The opening scene is not active.');
    if (!Number.isInteger(fromIndex) || fromIndex > room.storyDialogueIndex) return replyError(ack, 'That story line is not available yet.');
    if (fromIndex === room.storyDialogueIndex && room.storyDialogueIndex < STORY_DIALOGUE_BEAT_COUNT - 1) room.storyDialogueIndex += 1;
    broadcast(room);
    replyOk(ack);
  });
  socket.on('story:intro-skip', (_data, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || room.phase !== 'storyIntro') return replyError(ack, 'The opening scene is not active.');
    room.storyDialogueIndex = STORY_DIALOGUE_BEAT_COUNT - 1;
    player.introComplete = true;
    advanceStoryIntro(room);
    broadcast(room);
    replyOk(ack);
  });
  socket.on('scene:inspect', ({ objectId } = {}, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || room.phase !== 'investigation') return replyError(ack, 'There is no active investigation scene.');
    if (!player.introComplete) return replyError(ack, 'Finish or skip the opening scene first.');
    if (room.inspected.includes(player.id)) return replyError(ack, 'You have already examined an object this round.');
    const scene = INVESTIGATION_SCENES[room.round - 1];
    const object = scene?.objects.find((item) => item.id === objectId);
    if (!object) return replyError(ack, 'That object is not part of this investigation scene.');
    if (room.foundObjects.includes(objectId)) return replyError(ack, 'Another player has already examined that object. Choose a different one.');
    room.inspected.push(player.id); room.foundObjects.push(objectId); room.inspections[player.id] = objectId;
    const meta = SCENE_EVIDENCE[object.id] || {};
    room.publicClues.push({ id: `scene-${room.round}-${object.id}`, objectId: object.id, title: object.title, text: object.text, tags: meta.tags || [], reliability: meta.reliability || 'FIELD OBSERVATION', explanation: meta.explanation || 'Compare this observation with other evidence.', timestamp: meta.timestamp || 'CASE TIMELINE', optional: true, source: 'scene', location: scene.title, foundBy: player.name, foundByCharacterId: player.characterId, round: room.round });
    resolveCombinations(room);
    systemChat(room, `${player.name} discovered evidence: ${object.title}.`);
    broadcast(room);
    maybeFinishRound(room);
    replyOk(ack);
  });
  socket.on('round:choose', ({ optionId } = {}, ack) => {
    const { room, player } = getPlayer(socket); if (!room || !player || room.phase !== 'investigation') return replyError(ack, 'There is no open investigation choice.');
    if (!room.inspected.includes(player.id)) return replyError(ack, 'Examine one object in the scene before choosing a group lead.');
    if (!ROUND_OPTIONS[room.round - 1].some((o) => o.id === optionId)) return replyError(ack, 'That investigation lead is not available.');
    if (room.submitted.includes(player.id)) return replyError(ack, 'You already chose a lead this round.');
    room.choices[player.id] = optionId; room.submitted.push(player.id); broadcast(room);
    maybeFinishRound(room);
    replyOk(ack);
  });
  socket.on('shadow:deceive', ({ type, clueId } = {}, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || room.phase !== 'investigation') return replyError(ack, 'Deception actions are available only during an investigation round.');
    if (room.players.length < 3 || player.role !== 'Shadow') return replyError(ack, 'This private action is unavailable.');
    if (room.shadowActionUsed) return replyError(ack, 'Your one deception action has already been used.');
    if (type === 'plant') {
      const clue = { ...DECOY_CLUE, id: `decoy-${crypto.randomUUID()}`, source: 'unverified report', round: room.round, optional: true };
      room.publicClues.push(clue); room.shadowActionClueId = clue.id; room.shadowActionType = 'planted misleading evidence';
      systemChat(room, 'An unverified trace has appeared in the case file. Compare it against physical evidence.');
    } else if (type === 'veil') {
      const clue = room.publicClues.find((entry) => entry.id === clueId && entry.optional && !entry.decoy && !entry.challenged);
      if (!clue) return replyError(ack, 'Choose one available optional clue. Mandatory case evidence cannot be concealed.');
      room.hiddenClueId = clue.id; room.hiddenClueRestoreRound = Math.min(room.round + 1, 4); room.shadowActionClueId = clue.id; room.shadowActionType = 'temporarily concealed optional evidence';
      systemChat(room, 'One optional record has been temporarily obscured. It returns automatically after this round.');
    } else return replyError(ack, 'Choose a supported deception action.');
    room.shadowActionUsed = true; broadcast(room); replyOk(ack);
  });
  socket.on('evidence:challenge', ({ clueId } = {}, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || !['investigation', 'voting'].includes(room.phase)) return replyError(ack, 'There is no evidence to challenge now.');
    const clue = room.publicClues.find((entry) => entry.id === clueId && entry.decoy && !entry.challenged);
    if (!clue) return replyError(ack, 'That clue is not an active unverified report.');
    const confirmedWindow = room.publicClues.some((entry) => (entry.tags || []).includes('window-ruled-out'));
    if (!confirmedWindow) return replyError(ack, 'First compare the report with the archive window evidence.');
    clue.challenged = true;
    clue.challengeExplanation = 'The undisturbed inner latch contradicts the claimed window entry. The smear is not reliable evidence.';
    room.conclusions.push({ id: `challenge-${clue.id}`, title: 'The Window Report Is Contradicted', text: clue.challengeExplanation, source: 'evidence challenge', reliability: 'CORROBORATED DEDUCTION' });
    systemChat(room, 'The possible window entry was challenged against the intact latch evidence.'); broadcast(room); replyOk(ack);
  });
  socket.on('question:ask', ({ targetId, promptIndex } = {}, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || room.phase !== 'investigation') return replyError(ack, 'Questions are available during investigation rounds.');
    if (room.question) return replyError(ack, 'Resolve the current question before asking another.');
    if (room.questionUses.has(player.id)) return replyError(ack, 'You have already asked one question this round.');
    const target = room.players.find((entry) => entry.id === targetId && entry.id !== player.id && entry.online);
    if (!target || !Number.isInteger(promptIndex) || !QUESTION_PROMPTS[promptIndex]) return replyError(ack, 'Choose a connected student and a valid question.');
    room.questionUses.add(player.id);
    room.question = { id: crypto.randomUUID(), askerId: player.id, askerName: player.name, targetId: target.id, targetName: target.name, prompt: QUESTION_PROMPTS[promptIndex], round: room.round, createdAt: Date.now() };
    systemChat(room, `${player.name} asked ${target.name} a question. ${target.name} may respond or pass.`); broadcast(room); replyOk(ack);
  });
  socket.on('question:respond', ({ questionId, responseId } = {}, ack) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player || room.phase !== 'investigation' || !room.question || room.question.id !== questionId || room.question.targetId !== player.id) return replyError(ack, 'That question is no longer awaiting your response.');
    const response = STATEMENT_CLAIMS[responseId];
    if (!response) return replyError(ack, 'Choose one of the available responses or pass.');
    const tags = new Set(room.publicClues.flatMap((clue) => clue.tags || []));
    const contradicted = responseId === 'window-entry' && tags.has('window-ruled-out') || responseId === 'wet-trail' && tags.has('footprints-staged');
    room.statements.push({ id: crypto.randomUUID(), playerId: player.id, playerName: player.name, characterId: player.characterId, text: response.text, responseId, round: room.round, contradicted, contradiction: contradicted ? responseId === 'window-entry' ? 'Conflicts with the undisturbed inner window latch.' : 'Conflicts with the reversed mud pressure.' : null });
    const answered = room.question.targetName; room.question = null;
    systemChat(room, `${answered} responded to the question. Compare the statement with the shared evidence.`); broadcast(room); replyOk(ack);
  });
  socket.on('vote:submit', ({ suspectId } = {}, ack) => {
    const { room, player } = getPlayer(socket); if (!room || !player || room.phase !== 'voting') return replyError(ack, 'Voting is not open.');
    if (player.id in room.votes) return replyError(ack, 'Your vote has already been recorded.');
    if (suspectId !== 'ABSTAIN' && typeof suspectId !== 'string') return replyError(ack, 'Choose a suspect or abstain.');
    if (room.players.length === 2) {
      if (suspectId !== 'ABSTAIN' && !TWO_PLAYER_SUSPECTS.includes(suspectId)) return replyError(ack, 'Choose one of the NPC suspects or abstain.');
    } else if (suspectId !== 'ABSTAIN' && !room.players.some((p) => p.id === suspectId && p.id !== player.id)) return replyError(ack, 'Choose another student as your suspect or abstain.');
    room.votes[player.id] = suspectId; broadcast(room);
    if (Object.keys(room.votes).length === room.players.length) finishVote(room);
    replyOk(ack);
  });
  socket.on('chat:send', ({ text } = {}) => {
    const { room, player } = getPlayer(socket); const clean = String(text || '').trim().slice(0, 240);
    if (!room || !player || !clean) return;
    room.chat.push({ id: crypto.randomUUID(), name: player.name, text: clean, at: Date.now(), system: false }); room.chat = room.chat.slice(-100); broadcast(room);
  });
  socket.on('room:rematch', (_data, ack) => {
    const { room, player } = getPlayer(socket); if (!room || !player || player.id !== room.hostId || room.phase !== 'ended') return replyError(ack, 'Only the host can return this room to the lobby.');
    if (room.roundTimer) clearTimeout(room.roundTimer);
    room.phase = 'lobby'; room.round = 0; room.result = null; room.roundDeadline = null; room.voteDeadline = null; room.publicClues = []; room.conclusions = []; room.statements = []; room.question = null; room.questionUses = new Set(); room.hiddenClueId = null; room.hiddenClueRestoreRound = null; room.shadowActionUsed = false; room.shadowActionType = null; room.shadowActionClueId = null; room.shadowMotivation = null; room.voteTimer = null; room.submitted = []; room.choices = {}; room.votes = {}; room.roleConfirmations = new Set(); room.inspected = []; room.foundObjects = []; room.inspections = {}; room.activeStoryCast = []; room.storyDialogueIndex = 0;
    for (const p of room.players) { p.ready = p.id === room.hostId; p.role = null; p.privateClues = []; p.introComplete = false; }
    announce(room, 'The archive doors close. Ready up when you want to play again.'); replyOk(ack);
  });
  socket.on('disconnect', () => {
    const link = playerSockets.get(socket.id); playerSockets.delete(socket.id);
    const room = link && rooms.get(link.roomCode); const player = room?.players.find((p) => p.id === link.playerId);
    if (!room || !player || player.socketId !== socket.id) return;
    player.online = false;
    if (room.question && (room.question.targetId === player.id || room.question.askerId === player.id)) { room.question = null; systemChat(room, 'The open question was closed because a participant disconnected.'); }
    if (room.hostId === player.id) { const nextHost = room.players.find((p) => p.online && p.id !== player.id); if (nextHost) room.hostId = nextHost.id; }
    systemChat(room, `${player.name} disconnected. They can rejoin for 60 seconds.`);
    advanceRoleReveal(room);
    advanceStoryIntro(room);
    maybeFinishRound(room);
    broadcast(room);
    const timer = setTimeout(() => {
      room.disconnectTimers.delete(player.id);
      if (player.online) return;
      if (room.phase === 'lobby') { room.players = room.players.filter((p) => p.id !== player.id); if (!room.players.length) rooms.delete(room.code); else { if (room.hostId === player.id) room.hostId = room.players[0].id; broadcast(room); } }
      else if (room.phase === 'investigation') {
        if (!room.inspected.includes(player.id)) room.inspected.push(player.id);
        if (!room.submitted.includes(player.id)) { room.choices[player.id] = ROUND_OPTIONS[room.round - 1][0].id; room.submitted.push(player.id); }
        maybeFinishRound(room);
      }
      else if (room.phase === 'voting' && !room.votes[player.id]) { room.votes[player.id] = room.players.length === 2 ? 'ABSTAIN' : null; if (Object.keys(room.votes).length === room.players.length) finishVote(room); }
      broadcast(room);
    }, 60_000);
    room.disconnectTimers.set(player.id, timer);
  });
});

httpServer.listen(PORT, () => console.log(`Shadow Academy server listening on ${PORT}`));
