# hollow

A minimal, fast, anime-feeling stickman fighting game for two. SVG + CSS in the browser, a deterministic TypeScript sim at its core, and a WebSocket server for playing on phones over WiFi.

```bash
npm install
npm run dev        # game + WebSocket on http://localhost:5173 (also on your LAN, so phones can join)
npm run play       # production build, served with the WebSocket on :3000
npm test           # sim, API, server, AI and storage tests
npm run typecheck
```

Open <http://localhost:5173/sandbox.html> for the pose and animation sandbox.

**Controls**

| | P1 | P2 |
|---|---|---|
| move / jump / crouch | `A D W S` | `← → ↑ ↓` |
| light · heavy · skill | `J K L` | `, . /` |
| guard · dash | `U I` | `; '` |

`T` theme · `M` sound · `Esc` menu · `R` restart (local) · `` ` `` hitboxes. Phones get on-screen buttons.

**Students:** AI opponents that learn from you, on your device, offline. Play them, tune how hard they are (randomness and reaction sliders), or watch two of them fight. They tidy their own storage, and the Students screen shows what they use. See [docs/ai.md](docs/ai.md).

**On a phone:** landscape and fullscreen, with a thumb-stick and buttons laid over the game. It is an installable PWA, so after the first visit **local play works offline**; only *Play online* needs a network and the game server. See [mobile and PWA](docs/mobile-and-pwa.md).

**Docs** live in [docs/](docs/README.md). Start with [architecture](docs/architecture.md), then [combat model](docs/combat-model.md) and the [content guide](docs/content-guide.md) (how to add a skill in one entry).
