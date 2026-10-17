import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { CHARACTERS, getCharacter, getExpressionImage } from './characters.js';
import { getOpeningDialogue } from './storyDialogue.js';
import { academyAudio, loadSettings, saveSettings } from './audio.js';

const API_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
const socket = API_URL ? io(API_URL, { autoConnect: false, transports: ['websocket', 'polling'] }) : null;
const ROUND_NAMES = ['The Missing Document', 'Footsteps After Midnight', 'The Final Revelation'];
const CLUE_MOODS = {
  'archive-seal': 'shock', 'desk-drawer': 'suspicion', 'window-latch': 'relief', 'stopped-clock': 'shock', 'visitor-ledger': 'analysis', 'velvet-stand': 'worry',
  'wet-footprints': 'suspicion', 'glass-lantern': 'worry', 'broken-umbrella': 'curiosity', 'guard-note': 'shock', 'bell-cord': 'analysis', 'mud-print': 'suspicion',
  'silver-ink': 'analysis', 'tower-gears': 'shock', 'loose-stone': 'solution', 'tower-ledger': 'shock', 'brass-thread': 'curiosity', 'hidden-latch': 'solution'
};
const MOOD_EXPRESSIONS = {
  aoi: { shock: 'surprised', suspicion: 'suspicious', relief: 'happy', analysis: 'suspicious', worry: 'worried', curiosity: 'suspicious', solution: 'happy' },
  ren: { shock: 'shocked', suspicion: 'serious', relief: 'smirking', analysis: 'serious', worry: 'nervous', curiosity: 'serious', solution: 'smirking' },
  mika: { shock: 'surprised', suspicion: 'determined', relief: 'happy', analysis: 'determined', worry: 'frightened', curiosity: 'surprised', solution: 'determined' },
  haruto: { shock: 'surprised', suspicion: 'suspicious', relief: 'relieved', analysis: 'confident', worry: 'surprised', curiosity: 'suspicious', solution: 'confident' },
  yuna: { shock: 'shocked', suspicion: 'curious', relief: 'smiling', analysis: 'curious', worry: 'worried', curiosity: 'curious', solution: 'excited' },
  sota: { shock: 'surprised', suspicion: 'analytical', relief: 'pleased', analysis: 'analytical', worry: 'nervous', curiosity: 'confused', solution: 'pleased' }
};
const VOTE_EXPRESSIONS = { aoi: 'suspicious', ren: 'serious', mika: 'determined', haruto: 'confident', yuna: 'curious', sota: 'analytical' };
const ENDING_EXPRESSIONS = {
  aoi: { win: 'happy', lose: 'sad' }, ren: { win: 'smirking', lose: 'nervous' }, mika: { win: 'happy', lose: 'frightened' },
  haruto: { win: 'relieved', lose: 'angry' }, yuna: { win: 'smiling', lose: 'worried' }, sota: { win: 'pleased', lose: 'confused' }
};

function emitAck(event, data = {}) {
  if (!socket) return Promise.resolve({ ok: false, error: 'The multiplayer server is not configured. Set VITE_SERVER_URL for this deployment.' });
  return new Promise((resolve) => socket.emit(event, data, (reply) => resolve(reply || { ok: false, error: 'The server did not respond.' })));
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [me, setMe] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [chatText, setChatText] = useState('');
  const [previewCharacterId, setPreviewCharacterId] = useState('aoi');
  const [roleReminderOpen, setRoleReminderOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [dialogueShown, setDialogueShown] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceTab, setEvidenceTab] = useState('shared');
  const [clockNow, setClockNow] = useState(Date.now());
  const [questionTarget, setQuestionTarget] = useState('');
  const [questionPrompt, setQuestionPrompt] = useState(0);
  const [veilTarget, setVeilTarget] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioSettings, setAudioSettings] = useState(loadSettings);
  const chatEnd = useRef(null);
  const previousPhase = useRef(null);
  const lastCountdownBell = useRef(null);
  const myClues = useMemo(() => room?.myClues || [], [room]);

  useEffect(() => { saveSettings(audioSettings); academyAudio.applySettings(audioSettings); }, [audioSettings]);

  const audioScene = !room || room.phase === 'lobby' ? 'lobby'
    : room.phase === 'storyIntro' || (room.phase === 'investigation' && !me?.introComplete) ? 'opening'
      : room.phase === 'investigation' ? ['library', 'corridor', 'tower'][Math.max(0, Math.min(2, (room.round || 1) - 1))]
        : room.phase === 'voting' ? 'voting'
          : room.phase === 'ended' ? (me?.gameWon ? (room.players.length > 2 && me?.role === 'Shadow' ? 'shadow' : 'investigator') : 'defeat') : 'lobby';
  useEffect(() => { academyAudio.setScene(audioScene, audioSettings); }, [audioScene, audioSettings]);

  useEffect(() => {
    if (!room?.phase || room.phase === previousPhase.current) return;
    if (room.phase === 'ended') academyAudio.playSfx('reveal');
    else if (room.phase === 'voting') academyAudio.playSfx('bell');
    previousPhase.current = room.phase;
  }, [room?.phase]);

  useEffect(() => {
    const deadline = room?.phase === 'voting' ? room.voteDeadline : room?.phase === 'investigation' ? room.roundDeadline : null;
    if (!deadline) { lastCountdownBell.current = null; return; }
    const secondsLeft = Math.ceil((deadline - clockNow) / 1000);
    const bellKey = `${room.phase}:${deadline}`;
    if (secondsLeft === 10 && lastCountdownBell.current !== bellKey) {
      lastCountdownBell.current = bellKey;
      academyAudio.playSfx('bell');
    }
  }, [room?.phase, room?.voteDeadline, room?.roundDeadline, clockNow]);

  useEffect(() => {
    if (!socket) {
      setNotice('The multiplayer server is not configured. Set VITE_SERVER_URL for this deployment.');
      return undefined;
    }
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onSnapshot = ({ room: nextRoom, me: nextMe }) => { setRoom(nextRoom); setMe(nextMe); setNotice(''); };
    const onError = ({ message }) => { setNotice(message); setBusy(false); };
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect);
    socket.on('room:snapshot', onSnapshot); socket.on('game:error', onError);
    socket.connect();
    const saved = sessionStorage.getItem('shadow-player');
    if (saved) { try { socket.once('connect', () => socket.emit('player:reconnect', JSON.parse(saved))); } catch { sessionStorage.removeItem('shadow-player'); } }
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('room:snapshot', onSnapshot); socket.off('game:error', onError); socket.disconnect(); };
  }, []);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [room?.chat?.length]);

  const activeStoryCast = room?.activeStoryCast || [];
  const dialogueLines = useMemo(() => getOpeningDialogue(activeStoryCast), [activeStoryCast]);
  const dialogueIndex = Math.min(room?.storyDialogueIndex || 0, Math.max(0, dialogueLines.length - 1));
  const dialogueLine = dialogueLines[dialogueIndex];
  const dialogueAccent = getCharacter(dialogueLine?.characterId)?.accent || '#e0cb82';
  useEffect(() => {
    if (room?.phase !== 'storyIntro' && !(room?.phase === 'investigation' && !me?.introComplete)) return undefined;
    if (!dialogueLine?.text) return undefined;
    setDialogueShown(0);
    const timer = setInterval(() => setDialogueShown((shown) => Math.min(dialogueLine.text.length, shown + 2)), 24);
    return () => clearInterval(timer);
  }, [room?.phase, me?.introComplete, dialogueIndex, dialogueLine?.text]);

  useEffect(() => {
    if (!['investigation', 'voting'].includes(room?.phase)) return undefined;
    const timer = setInterval(() => setClockNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [room?.phase]);

  async function action(event, data) {
    if (event === 'room:create' || event === 'room:join' || event === 'game:start') await academyAudio.unlock(audioSettings);
    setBusy(true); setNotice('');
    const result = await emitAck(event, data);
    setBusy(false);
    if (!result.ok) setNotice(result.error || 'That action could not be completed.');
    if (result.session) sessionStorage.setItem('shadow-player', JSON.stringify(result.session));
    if (result.room) { setRoom(result.room); setMe(result.me); }
    if (result.ok && event === 'scene:inspect') academyAudio.playSfx('clue');
    if (result.ok && event === 'evidence:challenge') academyAudio.playSfx('evidence');
    if (result.ok && event === 'vote:submit') academyAudio.playSfx('vote');
    if (result.ok && event === 'story:dialogue-advance') academyAudio.playSfx('dialogue');
    return result;
  }

  const isHost = room?.hostId === me?.id;
  const previewIsTaken = room?.players?.some((player) => player.id !== me?.id && player.characterId === previewCharacterId);
  const firstFreeCharacter = CHARACTERS.find((character) => !room?.players?.some((player) => player.id !== me?.id && player.characterId === character.id));
  const selectedCharacter = getCharacter(me?.characterId || (previewIsTaken ? firstFreeCharacter?.id : previewCharacterId)) || CHARACTERS[0];

  function createRoom() { action('room:create', { name: name.trim() }); }
  function joinRoom() { action('room:join', { name: name.trim(), code: code.trim().toUpperCase() }); }
  function setReady() { action('player:ready', { ready: !me?.ready }); }
  function chooseCharacter(characterId) { setPreviewCharacterId(characterId); if (characterId !== me?.characterId) action('player:character', { characterId }); }
  function advanceDialogue() { if (!dialogueLine) return; if (dialogueShown < dialogueLine.text.length) { setDialogueShown(dialogueLine.text.length); return; } if (dialogueIndex < dialogueLines.length - 1) { action('story:dialogue-advance', { fromIndex: dialogueIndex }); return; } action('story:intro-complete'); }
  function skipOpening() { action('story:intro-skip'); }
  function sendChat(e) { e.preventDefault(); if (!chatText.trim() || !socket) return; socket.emit('chat:send', { text: chatText.trim() }); setChatText(''); }

  return <main className={`app-shell phase4-shell ${room ? 'in-room' : 'home-shell'} ${audioSettings.animationsEnabled ? '' : 'motion-disabled'}`} onClickCapture={(event) => { if (event.target.closest('button') && !event.target.closest('[data-silent-audio]')) academyAudio.playSfx('ui'); }}>
    <header className="topbar"><a className="brand" href="#home"><span className="brand-mark">✦</span><span>SHADOW <b>ACADEMY</b></span></a><div className="topbar-tools"><button className="settings-trigger" onClick={() => setSettingsOpen(true)} aria-label="Open audio and display settings">☼ <span>SOUND & DISPLAY</span></button><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'LIVE CONNECTION' : socket ? 'CONNECTING…' : 'SERVER NOT CONFIGURED'}</span></div></header>
    {!room ? <section className="landing" id="home">
      <div className="hero-copy"><div className="eyebrow"><span /> EPISODE 01 · THE MIDNIGHT ARCHIVE</div><h1>THE TRUTH<br/>IS <em>IN THE SHADOWS.</em></h1><p className="intro">A sealed archive. A vanished document. One truth hidden among the students. Can you uncover it before the final bell?</p>
        <div className="join-card"><label htmlFor="player-name">YOUR ACADEMY NAME</label><input id="player-name" maxLength={18} placeholder="Enter a name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="join-actions"><button className="button primary" onClick={createRoom} disabled={busy || !name.trim()}><span>＋</span> Create a room</button><div className="join-divider">OR JOIN FRIENDS</div><div className="join-row"><input aria-label="Room code" maxLength={6} placeholder="ROOM CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && joinRoom()} /><button className="button secondary" onClick={joinRoom} disabled={busy || !name.trim() || code.trim().length < 4}>Join room <span>→</span></button></div></div>
        </div><div className="features"><div><b>02–06</b><span>PLAYERS</span></div><div><b>NO ACCOUNT</b><span>JUST A ROOM CODE</span></div><div><b>10–15</b><span>MINUTES</span></div></div>
      </div><div className="hero-art"><div className="moon"/><div className="academy-window"><div className="window-glow"/><span className="window-cross x1"/><span className="window-cross x2"/><span className="silhouette">◈</span></div><div className="hero-quote">“Every secret leaves a trace.”<span>— THE HEAD LIBRARIAN</span></div><div className="art-label">NO. 01 <span>THE MIDNIGHT ARCHIVE</span></div></div>
    </section> : room.phase === 'lobby' ? <section className="game-layout lobby-layout">
      <div className="lobby-panel">
        <div className="lobby-heading"><div><div className="eyebrow"><span/> SHADOW ACADEMY · MIDNIGHT ARRIVALS</div><h2>Choose your place in the story.</h2><p>Meet the students. Take a seat before the archive doors open.</p></div>
          <div className="invite-plaque"><span>INVITATION CODE</span><strong>{room.code}</strong><button onClick={() => navigator.clipboard?.writeText(room.code)} aria-label="Copy room code">COPY</button></div>
        </div>
        <div className="lobby-body">
          <section className="selection-section" aria-label="Character selection">
            <div className="section-kicker">YOUR ACADEMY IDENTITY <span>Choose one student</span></div>
            <div className="featured-character" style={{'--character-accent':selectedCharacter.accent}}>
              <CharacterPortrait character={selectedCharacter} className="featured-portrait" />
              <div className="character-bio"><div className="character-epithet">{me?.characterId ? selectedCharacter.epithet : 'PREVIEW · NOT YET SELECTED'} <span>✦</span></div><h3>{selectedCharacter.name}</h3><div className="character-club">{selectedCharacter.club}</div><p className="personality">{selectedCharacter.personality}</p><p className="bio-copy">{selectedCharacter.bio}</p><div className="role-note"><span>◈</span> Character choice never changes your secret role.</div></div>
            </div>
            <div className="character-picker-label"><span>SELECT A STUDENT</span><small>{me?.characterId ? 'Choose another available identity to change' : 'Select a portrait to claim that identity'}</small></div>
            <div className="character-gallery">{CHARACTERS.map((character) => {
              const selectedBy = room.players.find((player) => player.characterId === character.id && player.id !== me?.id);
              const selected = me?.characterId === character.id;
              return <button key={character.id} className={`character-tile ${selected ? 'is-selected' : ''} ${selectedBy ? 'is-taken' : ''}`} style={{'--character-accent':character.accent}} onClick={() => chooseCharacter(character.id)} disabled={busy || Boolean(selectedBy)} aria-pressed={selected} title={selectedBy ? `Chosen by ${selectedBy.name}` : `Choose ${character.name}`}>
                <CharacterPortrait character={character} className="tile-portrait"/><span className="tile-name">{character.name.split(' ')[0]}</span><span className="tile-state">{selected ? 'YOUR CHOICE' : selectedBy ? `WITH ${selectedBy.name.toUpperCase()}` : character.epithet.toUpperCase()}</span>
              </button>;
            })}</div>
          </section>
          <aside className="party-section">
            <div className="section-kicker">THE STUDENTS GATHERING <span>{room.players.length} / 6</span></div>
            <div className="party-list">{room.players.map((player) => {
              const character = CHARACTERS.find((entry) => entry.id === player.characterId);
              return <div className={`party-card ${player.ready ? 'party-ready' : ''}`} key={player.id} style={{'--character-accent':character?.accent || '#ada2c0'}}>
                {character ? <CharacterPortrait character={character} className="party-portrait"/> : <div className="party-empty-portrait">✦</div>}
                <div className="party-info"><b>{player.name}{player.id === me?.id && <small className="you-tag">YOU</small>}</b><span>{character?.name || 'Choose a student'}</span><div className="party-badges">{player.id === room.hostId && <em>HOST</em>}{!character && <em className="choose-badge">IDENTITY NEEDED</em>}<em className={player.ready ? 'ready-badge' : ''}>{player.ready ? 'READY' : 'GETTING READY'}</em></div></div>
                <span className={`online-indicator ${player.online ? 'connected' : ''}`} title={player.online ? 'Connected' : 'Reconnecting'} />
              </div>;
            })}</div>
            <div className="lobby-rule"><span>✦</span><p><b>{room.players.length === 2 ? 'Cooperative mystery' : 'A secret among you'}</b><br/>{room.players.length === 2 ? 'Two investigators search for the NPC culprit.' : room.players.length < 3 ? 'Invite one more player to begin hidden-role mode.' : 'One student will secretly become the Shadow.'}</p></div>
            <div className="lobby-controls"><button className={`button ${me?.ready ? 'ready-button' : 'secondary'}`} onClick={setReady} disabled={busy || !me?.characterId}>{!me?.characterId ? 'CHOOSE A STUDENT' : me.ready ? '✓  READY' : 'I’M READY'}</button>{isHost && <button className="button primary start-button" onClick={() => action('game:start')} disabled={busy || room.players.length < 2 || !room.players.every((p) => p.ready && p.online && p.characterId)}>{room.players.length < 2 ? 'WAITING FOR STUDENTS' : room.players.some((p) => !p.characterId) ? 'EVERYONE CHOOSE A STUDENT' : !room.players.every((p) => p.ready && p.online) ? 'WAITING FOR THE OTHERS' : 'BEGIN INVESTIGATION'} <span>→</span></button>}</div>
          </aside>
        </div>
      </div><Chat room={room} text={chatText} setText={setChatText} onSend={sendChat} endRef={chatEnd}/>
    </section> : room.phase === 'roleReveal' ? <section className={`role-reveal-screen ${me?.role === 'Shadow' ? 'is-shadow' : 'is-investigator'}`}>
      <div className="role-reveal-backdrop" aria-hidden="true"><span className="role-orbit orbit-one"/><span className="role-orbit orbit-two"/><span className="role-sigil">✦</span></div>
      <div className="role-reveal-content">
        <div className="eyebrow"><span/> SHADOW ACADEMY · PRIVATE ROLE TRANSMISSION</div>
        <div className="role-reveal-card">
          <div className="role-portrait-wrap"><CharacterPortrait character={getCharacter(me?.characterId)} className="role-portrait"/><span className="role-seal">{me?.role === 'Shadow' ? '☾' : '✦'}</span></div>
          <div className="role-copy"><span className="role-eyebrow">THIS MESSAGE IS ONLY FOR YOU</span><div className="role-mark">{me?.role === 'Shadow' ? '☾' : '✦'}</div><h1>{me?.role === 'Shadow' ? 'YOU ARE THE SHADOW' : 'YOU ARE AN INVESTIGATOR'}</h1>
            <p className="role-flavour">{me?.role === 'Shadow' ? 'The academy trusts you. Keep it that way.' : room.players.length === 2 ? 'Stand together. The culprit is hiding beyond the student body.' : 'Every student has a story. One of them is hiding the truth.'}</p>
            <h2>YOUR MISSION</h2>
            {me?.role === 'Shadow' ? <ul className="mission-list"><li>Protect Head Librarian Kisaragi, the document thief.</li><li>Hide your identity through your own discussion and choices.</li><li>Use one secret action: plant a challengeable clue or veil one optional clue until next round.</li><li>Avoid a unique plurality of votes; the motive is revealed after the case.</li></ul> : <ul className="mission-list"><li>Examine clues across all three rounds.</li><li>Separate the document thief from the student protecting him.</li><li>{room.players.length === 2 ? 'Both investigators must vote for Head Librarian Kisaragi.' : 'Identify and vote for the Shadow using evidence and player statements.'}</li><li>Win if {room.players.length === 2 ? 'you agree on the NPC culprit.' : 'the Shadow receives a unique plurality.'}</li></ul>}
          </div>
        </div>
        <div className="role-briefing"><div className="briefing-title"><span>FIELD GUIDE</span><button onClick={() => setTutorialOpen(true)}>FULL RULES ↗</button></div><div className="briefing-steps"><div><b>01</b><span>Read your private clue each round.</span></div><div><b>02</b><span>Discuss in team chat, then choose a lead.</span></div><div><b>03</b><span>After three rounds, vote to decide the case.</span></div></div></div>
        <div className="role-confirm-row"><button className="role-confirm-button" onClick={() => action('player:confirm-role')} disabled={busy || me?.roleConfirmed}>{me?.roleConfirmed ? '✓  ROLE CONFIRMED' : 'I UNDERSTAND — BEGIN INVESTIGATION'}{!me?.roleConfirmed && <span>→</span>}</button><p>{me?.roleConfirmed ? 'Your role is confirmed. Waiting for other connected players…' : 'Your role stays private. Only you can see this screen.'}<b>{room.roleConfirmationCount || 0} / {room.connectedPlayerCount || room.players.filter((player) => player.online).length} CONFIRMED</b></p></div>
        <button className="role-utility" onClick={() => setRoleReminderOpen(true)}>MY ROLE</button>
      </div>
    </section> : room.phase === 'storyIntro' || (room.phase === 'investigation' && !me?.introComplete) ? <section className="game-layout intro-layout">
      <div className="visual-novel" style={{'--dialogue-accent': dialogueAccent}}>
        <div className="vn-background"/><div className="vn-topline"><span>EPISODE 01 · THE MIDNIGHT ARCHIVE</span><button onClick={skipOpening} disabled={busy || !dialogueLine}>SKIP INTRO ↗</button></div>
        <div className="vn-scene-caption">SHADOW ACADEMY · 12:07 AM</div>
        <div className={`vn-cast cast-count-${activeStoryCast.length}`} data-cast-count={activeStoryCast.length} aria-label={`${activeStoryCast.length} player-selected characters in the opening scene`}>{activeStoryCast.map((characterId) => {
          const character = getCharacter(characterId);
          if (!character) return null;
          const owner = room.players.find((player) => player.characterId === character.id);
          const speaking = dialogueLine?.characterId === character.id;
          return <div key={character.id} className={`vn-cast-card ${speaking ? 'is-speaking' : 'is-dimmed'} is-player-controlled`} title={`${character.name} · played by ${owner?.name || 'room player'}`}>
            <CharacterPortrait character={character} className="vn-cast-portrait" expression={speaking ? dialogueLine.expression : undefined}/><span>{character.name.split(' ')[0]}</span><small>{owner?.id === me?.id ? 'YOU' : 'PLAYER'}</small>
          </div>;
        })}</div>
        <div className="vn-dialogue-wrap" key={`${dialogueLine?.characterId || 'loading'}-${dialogueIndex}`}>
          {dialogueLine ? <><div className={`vn-portrait is-speaking expression-${dialogueLine.expression}`}><CharacterPortrait character={getCharacter(dialogueLine.characterId)} className="vn-character-portrait" expression={dialogueLine.expression}/><span className="vn-expression-tag">{dialogueLine.expression.toUpperCase()}</span></div>
          <button className="vn-dialogue-box is-character-speaking" data-silent-audio onClick={advanceDialogue} aria-label="Advance dialogue"><span className="vn-speaker">{dialogueLine.speakerName}</span><p>{dialogueLine.text.slice(0, dialogueShown)}{dialogueShown < dialogueLine.text.length && <i className="type-caret"/>}</p><span className="vn-next-hint">{dialogueShown < dialogueLine.text.length ? 'CLICK TO REVEAL' : dialogueIndex === dialogueLines.length - 1 ? 'ENTER INVESTIGATION' : 'CONTINUE  ▸'}</span></button></> : <div className="vn-sync-loading" role="status">Synchronising the selected students…</div>}
        </div>
        <div className="vn-controls"><span>{String(dialogueIndex+1).padStart(2,'0')} / {String(dialogueLines.length || 6).padStart(2,'0')} · OPENING SCENE</span><button onClick={() => setDialogueShown(dialogueLine?.text.length || 0)} disabled={!dialogueLine || dialogueShown >= dialogueLine.text.length}>SHOW TEXT</button><button className="vn-next-button" data-silent-audio onClick={advanceDialogue} disabled={busy || !dialogueLine}>{dialogueShown < (dialogueLine?.text.length || 0) ? 'SHOW LINE' : dialogueIndex === dialogueLines.length - 1 ? 'BEGIN INVESTIGATION →' : 'NEXT →'}</button></div>
        <div className="vn-sync-note">{room.introConnectedCount > 1 ? `Your teammates are in the opening scene · ${room.introProgress}/${room.introConnectedCount} ready` : 'The academy is silent. You are the only connected student.'}</div>
      </div><Chat room={room} text={chatText} setText={setChatText} onSend={sendChat} endRef={chatEnd}/>
    </section> : room.phase === 'investigation' ? <section className="game-layout investigation-layout">
      <InvestigationScene room={room} me={me} busy={busy} now={clockNow} questionTarget={questionTarget} setQuestionTarget={setQuestionTarget} questionPrompt={questionPrompt} setQuestionPrompt={setQuestionPrompt} veilTarget={veilTarget} setVeilTarget={setVeilTarget} onAction={action} onOpenEvidence={() => { setEvidenceOpen(true); academyAudio.playSfx('evidence'); }} onOpenTutorial={() => setTutorialOpen(true)} onOpenRole={() => setRoleReminderOpen(true)}/>
      <Chat room={room} text={chatText} setText={setChatText} onSend={sendChat} endRef={chatEnd}/>
    </section> : room.phase === 'voting' ? <section className="game-layout"><div className="main-panel play-panel"><div className="panel-head"><div><div className="eyebrow">EPISODE 01 · FINAL ACCUSATION</div><h2>Make your accusation.</h2></div><span className="pill">FINAL VOTE</span></div><CharacterStrip players={room.players}/><div className="game-utility"><span>COMPARE THE CASE FILE</span><button data-silent-audio onClick={() => { setEvidenceOpen(true); academyAudio.playSfx('evidence'); }}>◈ EVIDENCE BOARD</button><button onClick={() => setRoleReminderOpen(true)}>MY ROLE</button><button onClick={() => setTutorialOpen(true)}>? HOW TO PLAY</button></div>
        <div className="vote-countdown" aria-live="polite"><span>TIME TO DECIDE</span><strong>{String(Math.floor(Math.max(0, (room.voteDeadline - clockNow) / 1000) / 60)).padStart(2,'0')}:{String(Math.max(0, Math.ceil((room.voteDeadline - clockNow) / 1000) % 60)).padStart(2,'0')}</strong><small>{room.voteCount || 0}/{room.players.length} votes recorded</small></div>
        <div className="vote-case-brief"><b>THE TWO QUESTIONS</b><p><strong>Who stole the sealed document?</strong> Head Librarian Kisaragi used an authorized key and the restoration passage.</p><p><strong>Who is protecting him?</strong> In hidden-role games, identify the student whose statements or choices conflict with verified evidence. The Shadow is a separate role from the thief.</p><small>Shared deductions: {(room.conclusions || []).map((clue) => clue.title).join(' · ') || 'Review the case file before deciding.'}</small></div>
        <p className="story-text">{room.players.length === 2 ? 'Both investigators must identify Head Librarian Kisaragi to solve the cooperative case. Split votes or abstentions leave the culprit unidentified.' : 'Choose the student you believe is secretly protecting Kisaragi. A unique plurality catches the Shadow. A tie or no votes means the Shadow escapes.'}</p><div className="suspect-list">{room.players.length === 2 ? (room.npcSuspects || []).map((suspect) => <button key={suspect} disabled={busy || Boolean(room.myVote)} className={`suspect ${room.myVote === suspect ? 'selected' : ''}`} data-silent-audio onClick={() => action('vote:submit', { suspectId: suspect })}><span className="avatar avatar-2">{suspect.slice(0,1)}</span>{suspect}<i>{room.myVote === suspect ? 'VOTE CAST ✓' : 'ACCUSE →'}</i></button>) : room.players.map((player) => player.id !== me.id && <button key={player.id} disabled={busy || Boolean(room.myVote)} className={`suspect ${room.myVote === player.id ? 'selected' : ''}`} data-silent-audio onClick={() => action('vote:submit', { suspectId: player.id })}><CharacterPortrait character={getCharacter(player.characterId)} className="suspect-portrait"/>{player.name}<i>{room.myVote === player.id ? 'VOTE CAST ✓' : 'ACCUSE →'}</i></button>)}<button className={`suspect abstain-choice ${room.myVote === 'ABSTAIN' ? 'selected' : ''}`} data-silent-audio disabled={busy || Boolean(room.myVote)} onClick={() => action('vote:submit',{suspectId:'ABSTAIN'})}>ABSTAIN<i>{room.myVote === 'ABSTAIN' ? 'RECORDED ✓' : 'PASS →'}</i></button></div>{room.myVote && <div className="vote-reaction"><CharacterPortrait character={getCharacter(me.characterId)} expression={VOTE_EXPRESSIONS[me.characterId]} className="vote-reaction-portrait"/><div><b>{room.myVote === 'ABSTAIN' ? 'ABSTENTION RECORDED' : 'YOUR ACCUSATION IS SEALED'}</b><span>Your choice is private until every vote is in.</span></div></div>}{room.myVote && <div className="waiting-box">✓ Your anonymous vote is locked. Waiting for the others… <b>{room.voteCount}/{room.players.length}</b></div>}
      </div><Chat room={room} text={chatText} setText={setChatText} onSend={sendChat} endRef={chatEnd}/>
    </section> : <section className="game-layout ending-layout"><div className={`main-panel ending-panel cinematic-ending ${me?.role === 'Shadow' ? 'ending-shadow' : 'ending-investigator'} ${me?.gameWon ? 'ending-victory' : 'ending-defeat'} ${room.players.length === 2 ? 'ending-coop' : ''}`}>
      <div className="ending-backdrop-mark" aria-hidden="true">{me?.gameWon ? '✦' : '☾'}</div>
      <div className="ending-eyebrow">CASE CLOSED · EPISODE 01</div>
      <div className="ending-hero"><div className="ending-portrait-frame"><CharacterPortrait character={getCharacter(me?.characterId)} expression={ENDING_EXPRESSIONS[me?.characterId]?.[me?.gameWon ? 'win' : 'lose']} className="ending-player-portrait"/><span className="ending-reaction" aria-label={me?.gameWon ? 'Victory reaction' : 'Defeat reaction'}>{me?.gameWon ? '✦' : '…'}</span></div><div className="ending-verdict"><span className="ending-role-label">{room.players.length === 2 ? 'COOPERATIVE INVESTIGATION' : me?.role === 'Shadow' ? 'YOUR SECRET ROLE · SHADOW' : 'YOUR SECRET ROLE · INVESTIGATOR'}</span><h1>{me?.gameWon ? 'YOU WIN!' : 'YOU LOSE!'}</h1><div className="ending-subtitle">{room.players.length === 2 ? me?.gameWon ? 'INVESTIGATOR VICTORY' : 'INVESTIGATION FAILED' : me?.role === 'Shadow' ? me?.gameWon ? 'SHADOW VICTORY' : 'SHADOW DEFEAT' : me?.gameWon ? 'INVESTIGATOR VICTORY' : 'INVESTIGATION FAILED'}</div><p>{room.players.length === 2 ? me?.gameWon ? 'You correctly identified the NPC culprit and solved the mystery together.' : 'The accusation was incorrect. The academy’s secrets remain hidden.' : me?.role === 'Shadow' ? me?.gameWon ? 'You successfully concealed your identity. The Investigators failed to uncover the truth.' : 'Your identity has been exposed. The Investigators have uncovered the truth.' : me?.gameWon ? 'You uncovered the Shadow’s identity and solved the mystery.' : 'The Shadow escaped. The academy’s secrets remain hidden.'}</p></div></div>
      <div className="ending-facts"><div className="ending-facts-title"><span>THE CASE · SHARED RECORD</span><small>EVERY PLAYER SEES THESE FACTS</small></div><div className="ending-fact-grid"><div><span>CASE OUTCOME</span><strong>{room.result?.caseOutcome || (room.players.length === 2 ? room.result?.investigatorsWon ? 'NPC CULPRIT EXPOSED' : 'CULPRIT NOT IDENTIFIED' : room.result?.investigatorsWon ? 'THE SHADOW WAS CAUGHT' : 'THE SHADOW ESCAPED')}</strong></div><div><span>DOCUMENT THIEF</span><strong>{room.result?.thiefName || room.result?.culpritName || 'Unknown'}</strong><small>{room.players.length === 2 ? 'NPC CULPRIT' : 'HEAD LIBRARIAN'}</small></div>{room.players.length > 2 && <div><span>STUDENT SHADOW</span><strong>{room.result?.shadowName || 'Unknown'}</strong><small>{room.result?.shadowCharacterId ? getCharacter(room.result.shadowCharacterId)?.name : 'SECRET ROLE REVEALED'}</small></div>}<div><span>ACCUSED</span><strong>{room.result?.accusedNames?.length ? room.result.accusedNames.join(', ') : room.result?.accusedName || 'No clear accusation'}</strong></div></div><p className="ending-narrative"><b>{room.result?.title}</b> {room.result?.text}</p><p className="ending-narrative">{room.result?.explanation}</p>{room.result?.deception && <p className="ending-deception"><b>SHADOW'S DECEPTION REVEALED</b> {room.result.deception.type}: {room.result.deception.clue}. {room.result.deception.challenged ? 'Investigators challenged it successfully.' : 'The clue was not challenged before the vote.'}</p>}<div className="ending-clue-recap"><b>KEY EVIDENCE FOUND</b><span>{room.result?.importantClues?.join(' · ') || 'The shared case file was incomplete.'}</span></div></div>
      <div className="ending-actions">{isHost ? <button className="button primary" onClick={() => action('room:rematch')}>PLAY AGAIN <span>↻</span></button> : <p>Waiting for the host to open the academy for another case…</p>}<button className="ending-role-link" onClick={() => setRoleReminderOpen(true)}>◈ REVIEW MY ROLE</button></div>
    </div><Chat room={room} text={chatText} setText={setChatText} onSend={sendChat} endRef={chatEnd}/></section>}
    {evidenceOpen && <EvidenceBoard clues={room.publicClues || []} conclusions={room.conclusions || []} statements={room.statements || []} privateClues={myClues} tab={evidenceTab} setTab={setEvidenceTab} onAction={action} onClose={() => setEvidenceOpen(false)}/>}
    {roleReminderOpen && me?.role && <div className="guide-backdrop" role="presentation" onClick={() => setRoleReminderOpen(false)}><section className={`guide-dialog role-reminder ${me.role === 'Shadow' ? 'is-shadow' : 'is-investigator'}`} role="dialog" aria-modal="true" aria-labelledby="reminder-title" onClick={(event) => event.stopPropagation()}><button className="guide-close" onClick={() => setRoleReminderOpen(false)} aria-label="Close role reminder">×</button><div className="eyebrow">PRIVATE · ONLY YOU CAN SEE THIS</div><span className="guide-role-mark">{me.role === 'Shadow' ? '☾' : '✦'}</span><h2 id="reminder-title">{me.role === 'Shadow' ? 'YOU ARE THE SHADOW' : 'YOU ARE AN INVESTIGATOR'}</h2><p>{me.role === 'Shadow' ? 'Protect Kisaragi, conceal your identity, and use your one secret action wisely. Your motive remains private until the ending.' : room.players.length === 2 ? 'Examine clues and work together to identify Head Librarian Kisaragi.' : 'Kisaragi stole the document. Identify the separate student Shadow by comparing statements and choices with verified evidence.'}</p><button className="button secondary" onClick={() => setRoleReminderOpen(false)}>Return to investigation</button></section></div>}
    {tutorialOpen && <div className="guide-backdrop" role="presentation" onClick={() => setTutorialOpen(false)}><section className="guide-dialog tutorial-dialog" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" onClick={(event) => event.stopPropagation()}><button className="guide-close" onClick={() => setTutorialOpen(false)} aria-label="Close tutorial">×</button><div className="eyebrow">FIELD GUIDE · EPISODE 01</div><h2 id="tutorial-title">How to investigate</h2><div className="tutorial-list"><article><b>01 · BUILD THE CASE</b><p>Three rounds. Inspect one object, read your private clue, and choose a lead. Each route adds different evidence while mandatory clues keep Kisaragi’s route solvable.</p></article><article><b>02 · COMPARE</b><p>Share evidence if you choose, ask another player a question, and compare their voluntary response with verified records. A contradiction is evidence to discuss, not proof of a role.</p></article><article><b>03 · CHALLENGE</b><p>An unverified report can be challenged against physical evidence. In hidden-role matches the Shadow may once plant a decoy or veil one optional clue until the next round. Mandatory evidence cannot be removed.</p></article><article><b>04 · VOTE</b><p>Review case facts and suspect profiles before the countdown ends. Abstentions count as no accusation. Tied votes do not convict.</p></article><article><b>WINNING</b><p>{room.players.length === 2 ? 'Both investigators must agree on Head Librarian Kisaragi.' : 'Investigators need a unique plurality for the Shadow. The Shadow wins on a tie, abstention, or another player receiving more votes.'}</p></article></div><button className="button secondary" onClick={() => setTutorialOpen(false)}>Got it</button></section></div>}
    {settingsOpen && <SettingsDialog settings={audioSettings} onChange={(next) => setAudioSettings((current) => ({ ...current, ...next }))} onEnableAudio={async () => { const ready = await academyAudio.unlock(audioSettings); if (ready) academyAudio.playSfx('evidence'); }} onClose={() => setSettingsOpen(false)}/>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <footer><span>SHADOW ACADEMY: THE HIDDEN TRUTH</span><span>EPISODE 01 · THE MIDNIGHT ARCHIVE</span></footer>
  </main>;
}

function CharacterPortrait({ character, className = '', expression = null }) {
  const src = expression ? getExpressionImage(character.id, expression) || character.image : character.image;
  const [failedSource, setFailedSource] = useState('');
  const failed = failedSource === src;
  const fallbackFailed = failedSource === character.image;
  const displayedSource = failed && src !== character.image ? character.image : failed ? null : src;
  return <div className={`character-portrait character-${character.id} expression-${expression} ${className}`} style={{'--character-accent':character.accent}}>
    {displayedSource && !fallbackFailed ? <img key={displayedSource} src={displayedSource} alt={`${character.name}${expression ? ` · ${expression}` : ''} portrait`} loading="lazy" onError={() => setFailedSource(displayedSource)}/> : <span className="portrait-fallback">{character.name.split(' ').map((part) => part[0]).join('')}</span>}
  </div>;
}

function CharacterStrip({ players }) {
  return <div className="game-cast" aria-label="Players and chosen characters">{players.map((player) => {
    const character = getCharacter(player.characterId);
    return <div className="game-cast-item" key={player.id}><CharacterPortrait character={character} className="cast-portrait"/><span>{player.name}<small>{character.name}</small></span></div>;
  })}</div>;
}

function expressionForClue(clue) {
  const characterId = clue?.foundByCharacterId;
  return MOOD_EXPRESSIONS[characterId]?.[CLUE_MOODS[clue?.objectId]] || 'neutral';
}

function InvestigationScene({ room, me, busy, now, questionTarget, setQuestionTarget, questionPrompt, setQuestionPrompt, veilTarget, setVeilTarget, onAction, onOpenEvidence, onOpenTutorial, onOpenRole }) {
  const seconds = room.roundDeadline ? Math.max(0, Math.ceil((room.roundDeadline - now) / 1000)) : 0;
  const inspected = room.inspected?.includes(me.id);
  const submitted = room.submitted?.includes(me.id);
  const currentPrivateClue = room.myClues?.[room.myClues.length - 1];
  const latestSceneClue = room.publicClues?.filter((clue) => clue.source === 'scene' && clue.round === room.round).at(-1);
  return <div className="main-panel investigation-panel">
    <div className="investigation-topline"><div><div className="eyebrow">EPISODE 01 · ROUND {room.round} OF 3</div><h2>{room.scene?.title || ROUND_NAMES[room.round-1]}</h2><span className="scene-location">{room.scene?.location}</span></div><div className={`round-timer ${seconds <= 20 ? 'timer-urgent' : ''}`} aria-live="polite"><small>TIME LEFT</small><strong>{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</strong></div></div>
    <div className="game-utility"><span>YOUR ROLE IS PRIVATE</span><button data-silent-audio onClick={onOpenEvidence}>◈ CASE BOARD <i>{(room.publicClues?.length||0)+(room.conclusions?.length||0)+(room.myClues?.length||0)}</i></button><button onClick={onOpenRole}>MY ROLE</button><button onClick={onOpenTutorial}>? HOW TO PLAY</button></div>
    <div className="scene-instructions"><span>YOUR OBJECTIVE</span><p>{inspected ? submitted ? 'Your group lead is submitted. Discuss the clues while the other students finish.' : 'Object examined. Review the evidence, then submit one lead for the group.' : 'Examine one glowing object in the scene. Its clue will be shared with the group.'}</p></div>
    <div className="scene-stage" key={room.scene?.id} style={{'--scene-background':`url("${room.scene?.background || '/assets/scenes/forbidden-library.webp'}")`}}>
      <div className="scene-vignette"/><span className="scene-title-stamp">{room.scene?.title}</span><p className="scene-caption">{room.scene?.prompt}</p>
      {room.scene?.objects?.map((object) => {
        const clue = room.publicClues?.find((entry) => entry.objectId === object.id);
        const claimed = room.foundObjects?.includes(object.id);
        return <button key={object.id} className={`scene-hotspot ${claimed ? 'is-found' : ''}`} data-silent-audio style={{left:`${object.x}%`,top:`${object.y}%`}} onClick={() => onAction('scene:inspect',{objectId:object.id})} disabled={busy || inspected || claimed} aria-label={`${object.label}${claimed ? ' — already examined' : ''}`} title={claimed ? `Evidence discovered: ${clue?.title || object.label}` : object.label}>
          <span className="hotspot-ring">{claimed ? '✓' : '✦'}</span><span className="hotspot-label">{claimed ? 'FOUND' : object.label}</span>
        </button>;
      })}
      <div className="scene-ambience" aria-hidden="true"><i/><i/><i/><i/></div>
    </div>
    <div className="scene-progress"><div className="progress-item"><span>OBJECTS EXAMINED</span><strong>{room.foundObjects?.length || 0} <i>/ {room.scene?.objects?.length || 6}</i></strong></div><div className="progress-track"><span style={{width:`${Math.min(100,((room.inspected?.length||0)/room.players.length)*100)}%`}}/></div><div className="progress-item"><span>STUDENTS SEARCHING</span><strong>{room.inspected?.length || 0} <i>/ {room.players.length}</i></strong></div><div className="progress-item progress-leads"><span>GROUP LEADS SUBMITTED</span><strong>{room.submitted?.length || 0} <i>/ {room.players.length}</i></strong></div></div>
    <section className="interaction-card"><div className="interaction-heading"><b>QUESTION A STUDENT</b><small>PLAYER-CONTROLLED · ONE QUESTION PER ROUND</small></div>{room.question ? <div className="active-question"><p><b>{room.question.askerName} asks {room.question.targetName}:</b> {room.question.prompt}</p>{room.myQuestion ? <div className="response-options">{room.responseOptions?.map((response)=><button key={response.id} disabled={busy} onClick={()=>onAction('question:respond',{questionId:room.myQuestion.id,responseId:response.id})}>{response.label}</button>)}</div> : <small>Waiting for {room.question.targetName} to respond or pass. No statement is forced.</small>}</div> : <div className="question-controls"><select aria-label="Choose a student to question" value={questionTarget} onChange={(event)=>setQuestionTarget(event.target.value)}><option value="">Choose a student…</option>{room.players.filter((player)=>player.id!==me.id&&player.online).map((player)=><option key={player.id} value={player.id}>{player.name}</option>)}</select><select aria-label="Choose a question" value={questionPrompt} onChange={(event)=>setQuestionPrompt(Number(event.target.value))}>{room.questionPrompts?.map((prompt,index)=><option key={prompt} value={index}>{prompt}</option>)}</select><button disabled={busy||!questionTarget} onClick={()=>onAction('question:ask',{targetId:questionTarget,promptIndex:questionPrompt})}>ASK</button></div>}{room.statements?.length>0&&<div className="statement-feed">{room.statements.slice(-2).map((statement)=><p key={statement.id}><b>{statement.playerName}:</b> {statement.text}{statement.contradicted&&<em> Evidence conflict: {statement.contradiction}</em>}</p>)}</div>}</section>
    {me?.role==='Shadow'&&room.players.length>2&&<section className="shadow-action-card"><div className="interaction-heading"><b>PRIVATE COVER ACTION</b><small>{room.myDeception?.used?'USED · REVEALED AFTER THE CASE':'ONE USE · SERVER-VALIDATED'}</small></div>{room.myDeception?.used?<p>Your action is spent. Keep protecting Kisaragi through your own choices.</p>:<div className="shadow-action-controls"><button disabled={busy||!room.myDeception?.available} onClick={()=>onAction('shadow:deceive',{type:'plant'})}>PLANT A CHALLENGEABLE DECOY</button><select aria-label="Choose an optional clue to conceal" value={veilTarget} onChange={(event)=>setVeilTarget(event.target.value)}><option value="">Select optional clue…</option>{room.publicClues?.filter((clue)=>clue.optional&&clue.source!=='unverified report'&&!clue.challenged).map((clue)=><option key={clue.id} value={clue.id}>{clue.title}</option>)}</select><button disabled={busy||!veilTarget||!room.myDeception?.available} onClick={()=>onAction('shadow:deceive',{type:'veil',clueId:veilTarget})}>VEIL UNTIL NEXT ROUND</button></div>}<small>Mandatory evidence is protected. Other players see no action owner.</small></section>}
    {latestSceneClue && <article className="scene-discovery-card" key={latestSceneClue.id}><CharacterPortrait character={getCharacter(latestSceneClue.foundByCharacterId)} expression={expressionForClue(latestSceneClue)} className="discovery-character-portrait"/><div className="scene-discovery-copy"><span>SHARED DISCOVERY · FOUND BY {latestSceneClue.foundBy?.toUpperCase()}</span><b>{latestSceneClue.title}</b><p>{latestSceneClue.text}</p><small>ADDED TO THE SHARED EVIDENCE BOARD</small></div></article>}
    {currentPrivateClue && <article className="current-private-clue"><span>YOUR PRIVATE CLUE · ROUND {currentPrivateClue.round || room.round}</span><b>{currentPrivateClue.title}</b><p>{currentPrivateClue.text}</p><small>ONLY YOU CAN SEE THIS · OPEN THE EVIDENCE BOARD TO REVIEW EARLIER CLUES</small></article>}
    <div className="decision-box scene-decision"><div><b>Choose the group’s next lead</b><p>{submitted ? 'Your vote is recorded privately. The most selected lead will guide the team.' : inspected ? 'After discussing evidence, select one lead. The group follows the most selected option.' : 'Examine an object first to unlock your lead choice.'}</p></div>{submitted ? <div className="waiting-box">✓ LEAD SUBMITTED · Waiting for other students <b>{room.submitted?.length || 0}/{room.players.length}</b></div> : <div className="choice-grid">{room.options?.map((option) => <button className="choice" key={option.id} onClick={() => onAction('round:choose',{optionId:option.id})} disabled={busy || !inspected}><span>{option.icon}</span>{option.label}<i>→</i></button>)}</div>}</div>
  </div>;
}

function EvidenceBoard({ clues, conclusions, statements, privateClues, tab, setTab, onAction, onClose }) {
  return <div className="guide-backdrop evidence-backdrop" role="presentation" onClick={onClose}><section className="evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="evidence-title" onClick={(event)=>event.stopPropagation()}>
    <button className="guide-close" onClick={onClose} aria-label="Close evidence board">×</button><div className="eyebrow">EPISODE 01 · CASE FILE</div><h2 id="evidence-title">Evidence Board</h2><div className="evidence-tabs"><button className={tab==='shared'?'active':''} onClick={()=>setTab('shared')}>SHARED EVIDENCE <i>{clues.length}</i></button><button className={tab==='private'?'active':''} onClick={()=>setTab('private')}>MY PRIVATE CLUES <i>{privateClues.length}</i></button></div>
    <div className="evidence-list">{tab==='shared' ? <>{clues.length ? clues.map((clue)=><article className={`board-clue shared-board-clue ${clue.challenged?'is-challenged':''}`} key={clue.id}><span className="board-clue-mark">✦</span><div><small>{clue.location || clue.source || 'SHARED CASE EVIDENCE'}{clue.round ? ` · ROUND ${clue.round}` : ''} · {clue.timestamp||'TIME UNSPECIFIED'} · {clue.reliability||'UNVERIFIED'}</small><h3>{clue.title}</h3><p>{clue.text}</p>{clue.explanation&&<p className="clue-explanation"><b>WHY IT MATTERS</b> {clue.explanation}</p>}{clue.foundBy && <em>Discovered by {clue.foundBy}</em>}{clue.challengeAvailable&&<button className="challenge-clue-button" data-silent-audio onClick={()=>onAction('evidence:challenge',{clueId:clue.id})}>CHALLENGE AGAINST THE WINDOW RECORD</button>}{clue.challenged&&<em>CHALLENGED · {clue.challengeExplanation}</em>}</div></article>):<div className="evidence-empty">No shared evidence yet. Examine a highlighted object in the scene.</div>}{conclusions?.map((clue)=><article className="board-clue deduction-board-clue" key={clue.id}><span className="board-clue-mark">∴</span><div><small>{clue.source} · {clue.reliability}</small><h3>{clue.title}</h3><p>{clue.text}</p></div></article>)}{statements?.length>0&&<div className="statement-board"><h3>PLAYER STATEMENTS · COMPARE WITH THE FILE</h3>{statements.map((statement)=><p key={statement.id}><b>{statement.playerName}:</b> {statement.text}{statement.contradicted&&<em> — {statement.contradiction}</em>}</p>)}</div>}</> : privateClues.length ? privateClues.map((clue,i)=><article className="board-clue private-board-clue" key={`${clue.id}-${clue.round||i}`}><span className="board-clue-mark">◆</span><div><small>PRIVATE · ROUND {clue.round || i+1} · {clue.timestamp} · {clue.reliability}</small><h3>{clue.title}</h3><p>{clue.text}</p><p className="clue-explanation"><b>WHY IT MAY MATTER</b> {clue.explanation}</p><em>Only you can see this clue. Share it yourself if you choose.</em></div></article>) : <div className="evidence-empty">Your next private clue will arrive when its investigation round begins.</div>}</div>
    <button className="evidence-close-button" onClick={onClose}>RETURN TO INVESTIGATION</button>
  </section></div>;
}

function Chat({ room, text, setText, onSend, endRef }) {
  const [expanded, setExpanded] = useState(false);
  return <aside className={`chat-panel mobile-chat ${expanded ? 'chat-expanded' : 'chat-collapsed'}`}><div className="chat-head"><div><div className="eyebrow">SECURE CHANNEL</div><h3>Team chat</h3></div><span className="chat-live">● LIVE</span><button className="chat-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? 'HIDE CHAT ↑' : `OPEN CHAT ↓${room.chat?.length ? ` · ${room.chat.length}` : ''}`}</button></div><div className="chat-messages">{(room.chat || []).length === 0 && <div className="chat-empty">The channel is quiet.<br/>Share what you’ve found.</div>}{(room.chat || []).map((msg) => <div className={`message ${msg.system ? 'system-message' : ''}`} key={msg.id}><b>{msg.system ? 'ACADEMY SYSTEM' : msg.name}</b><p>{msg.text}</p><small>{new Date(msg.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></div>)}<div ref={endRef}/></div><form className="chat-form" onSubmit={onSend}><input maxLength={240} placeholder="Send a message…" aria-label="Chat message" value={text} onChange={(e) => setText(e.target.value)} /><button aria-label="Send message" disabled={!text.trim()}>↑</button></form><div className="chat-hint">Be kind. The mystery is more fun together.</div></aside>;
}

function SettingsDialog({ settings, onChange, onEnableAudio, onClose }) {
  return <div className="guide-backdrop settings-backdrop" role="presentation" onClick={onClose}><section className="guide-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}><button className="guide-close" onClick={onClose} aria-label="Close settings">×</button><div className="eyebrow">PERSONAL GAME SETTINGS</div><h2 id="settings-title">Sound & display</h2><p className="settings-intro">Sound begins only after you join or choose Enable Audio. Your settings stay on this device.</p><button className="button primary enable-audio-button" onClick={onEnableAudio}>ENABLE AUDIO <span>♫</span></button>
    <div className="setting-row"><div><b>Background music</b><small>Scene-based original synthesized score</small></div><button className={`setting-mute ${settings.musicMuted ? 'is-muted' : ''}`} aria-pressed={!settings.musicMuted} onClick={() => onChange({musicMuted:!settings.musicMuted})}>{settings.musicMuted ? 'MUTED' : 'ON'}</button></div><label className="setting-slider">Music volume <strong>{settings.musicVolume}%</strong><input type="range" min="0" max="70" value={settings.musicVolume} onChange={(event) => onChange({musicVolume:Number(event.target.value)})}/></label>
    <div className="setting-row"><div><b>Sound effects</b><small>Dialogue, clues, evidence and reveals</small></div><button className={`setting-mute ${settings.effectsMuted ? 'is-muted' : ''}`} aria-pressed={!settings.effectsMuted} onClick={() => onChange({effectsMuted:!settings.effectsMuted})}>{settings.effectsMuted ? 'MUTED' : 'ON'}</button></div><label className="setting-slider">Effects volume <strong>{settings.effectsVolume}%</strong><input type="range" min="0" max="80" value={settings.effectsVolume} onChange={(event) => onChange({effectsVolume:Number(event.target.value)})}/></label>
    <div className="setting-row animation-setting"><div><b>Character and scene animation</b><small>System reduced-motion preference is respected</small></div><button className={`setting-mute ${settings.animationsEnabled ? '' : 'is-muted'}`} aria-pressed={settings.animationsEnabled} onClick={() => onChange({animationsEnabled:!settings.animationsEnabled})}>{settings.animationsEnabled ? 'ON' : 'OFF'}</button></div><button className="button secondary settings-done" onClick={onClose}>DONE</button></section></div>;
}
