# Shadow Academy: The Hidden Truth

An original anime-inspired multiplayer mystery visual novel. Gather your friends, enter a room code, investigate the Midnight Archive, and decide who is protecting the real thief.

**Players:** 2–6 · **Episode:** 01 — *The Midnight Archive* · **Stack:** React, Vite, Node.js, Express, Socket.IO

## Screenshots

The screenshot section is reserved for genuine captures of the running game: the moonlit lobby, an investigation scene with the evidence board, and a final reveal. See [`docs/screenshots/README.md`](docs/screenshots/README.md) for capture notes. Character artwork is not presented as gameplay evidence.

## Play

1. One player creates a room and shares the six-character room code.
2. Other players join with the code. Each player chooses a distinct student, then marks Ready.
3. When everyone is ready, the host starts the game. Each player privately confirms their role and mission.
4. Follow the skippable opening, then investigate three locations. Each round, inspect one object, compare shared and private evidence, discuss in chat, and submit a group lead. Ask other players questions and review their public responses.
5. Before the final vote, compare the evidence and statements. Votes are private until the result is revealed.
6. Review the explanation, which reveals the document thief, the student Shadow if there is one, and how the evidence fits together.

### Modes and winning

- **2 players — cooperative:** both are Investigators. Identify Head Librarian Kisaragi, the NPC document thief. A correct accusation wins; an incorrect or unresolved accusation loses.
- **3–6 players — hidden role:** one student is randomly assigned the Shadow, secretly protecting Kisaragi; the other players are Investigators. Investigators win by giving the Shadow a unique plurality of votes. A tie, abstention, or timeout lets the Shadow escape. The Shadow wins by avoiding a unique plurality.
- Character selection is public and does not influence role assignment. Story dialogue adapts to the selected cast. Secret roles and personal clues are sent only to their owner until the ending.
- The Shadow can use one private, limited deception action. Investigators can challenge misleading evidence using verified evidence; mandatory clues cannot be destroyed or concealed.

### Controls and accessibility

Use the Sound & Display settings to adjust or mute music and effects, or disable animations. Settings are saved in the current browser. Audio starts after an interaction. The layout supports desktop, tablet, and mobile screens, and follows the system reduced-motion preference.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the Vite address printed in the terminal (normally `http://localhost:5173`). Open a second browser profile or private window to test another player. Local environment files are ignored by Git.

The `.env.example` files document the client and server variable names. Vite reads `client/.env.local`; the Node server reads environment variables supplied by the shell or hosting dashboard. The local development command already uses the local server URL and development CORS behavior.

The server keeps rooms in memory; a server restart ends active rooms. Players can reconnect to the same room from the same browser for 60 seconds while the server process remains available.

## Tests

Run the client production build and audio settings checks:

```bash
npm run build
npm run test:phase4-audio
```

For multiplayer tests, start the server in a separate terminal with `npm start`, then run:

```bash
npm run test:phase3
```

For accelerated investigation and voting timeout checks, run the server with shortened test timers, then run the timeout test in another terminal:

```bash
ROUND_TIME_LIMIT_MS=1200 VOTE_TIME_LIMIT_MS=1000 npm start
npm run test:timeouts
```

## Deployment

The repository includes [`render.yaml`](render.yaml) for the Socket.IO backend and [`vercel.json`](vercel.json) for the Vite frontend. Deploy the frontend and backend as separate services.

### Render backend

1. Create a Render Web Service from the repository using the root `render.yaml` Blueprint.
2. Keep the service root directory at the repository root, build command `npm ci`, and start command `npm run start --workspace server`.
3. Set `CLIENT_ORIGIN` to the exact deployed Vercel production origin, such as `https://your-project.vercel.app`. Multiple comma-separated origins are supported if required.
4. Render supplies `PORT`. The service exposes `/health` for health checks. Use the `https://` service URL in the browser; Socket.IO upgrades to secure WSS automatically.

Production startup fails if `CLIENT_ORIGIN` is missing. This prevents a production server from silently using permissive CORS settings.

### Vercel frontend

1. Import the repository as a Vite project. The included config installs from the root lockfile with `npm ci`, builds with `npm run build`, and publishes `client/dist`.
2. Set the production environment variable `VITE_SERVER_URL` to the Render HTTPS service origin (for example, `https://your-service.onrender.com`).
3. Deploy or redeploy after setting the variable. Production builds do not fall back to localhost; without the setting the interface reports that its multiplayer server is not configured.
4. Set Render's `CLIENT_ORIGIN` to the resulting Vercel production origin and redeploy the backend.

The frontend can be deployed before final backend wiring to establish its Vercel origin, then redeployed once the Render URL is available. Do not put secrets in `VITE_*` values; Vite exposes them to every browser.

### Hosting notes

The game uses in-memory rooms and does not need a database. A Render restart, redeploy, or free-tier spin-down clears active rooms. Free Render services may sleep after inactivity and need time to wake; use a paid always-on service only if this interruption is unacceptable. Keep the Socket.IO server on one instance unless room state and Socket.IO scaling are redesigned.

Vercel Hobby is suitable for personal, non-commercial use. Check current provider plan terms, included usage, and costs before moving to a commercial launch.

## Project structure

```text
client/                  React/Vite application and local artwork/audio
server/                  Express/Socket.IO server and authoritative game rules
scripts/                 Multiplayer, timeout, and audio-settings tests
docs/screenshots/         Genuine captures of the running game
render.yaml              Render backend Blueprint
vercel.json              Vercel/Vite build configuration
```

All character illustrations, scene art, and audio are bundled locally. The game does not fetch runtime artwork, fonts, or music from external URLs.
