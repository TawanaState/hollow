# Phones, installing, and playing offline

## Short answers

* **Can I install it on my phone and play with no internet?** Yes. After the first visit the whole game is stored on the phone by a service worker. **Local 2 players** and **Training dummy** work with no network at all (verified: server shut down, app reopened and played from cache).
* **Does it need the WebSocket?** Only for **Play online**. That mode connects to the game server, so it needs a network and a running server. Everything else does not.
* **Can I host it on Vercel?** Yes, as the *app*. Vercel cannot run the WebSocket server (its functions are short-lived, not long-running sockets), so for online play you run the server somewhere else and point the app at it. See below.

## Using it on a phone

* **Landscape, full screen.** The game fills the screen and keeps it awake. In portrait it asks you to turn the phone. Installed from the home screen it launches fullscreen and landscape, with no browser bars. In a normal browser tab, the ⛶ button (or `F`) goes fullscreen.
* **On-screen controls**, drawn translucent over the fight so nothing is hidden and nothing scrolls:
  * **Left thumb: a floating stick, and the dash.** Touch anywhere on the left half, then drag. Left/right moves, **flick up to jump**, **down to crouch**. Because it is one finger, diagonals work (jump forward). A dashed ring shows where it starts, with the **D**ash button just above it, so everything about movement is on the left. Hold dash to keep running.
  * **Right thumb: four buttons** in an arc, **L**ight under your thumb, then **H**eavy, **S**kill and **G**uard. They fill in when pressed and give a small vibration where the phone supports it.
  * **Pause (⏸)** is in the top bar. It freezes the match and the sound, and offers Resume, Restart and Quit to menu. **Esc** or **P** pause on a keyboard. The game also pauses by itself if you switch to another app. (Online matches cannot be paused, because the other player is still playing.)
* The page cannot be scrolled, pinch-zoomed or long-pressed into a menu, and respects notches (safe areas).
* The camera lifts the scene a little while controls are showing, so the fighters' feet are not under your thumbs.
* Controls appear on any touch device. `?touch` forces them on a desktop for testing.

## Installing (PWA)

| Platform | How |
|---|---|
| Android (Chrome, Edge) | Open the site, tap **Install app** in the menu (or the browser's install prompt). It appears on the home screen with the pencil-ring icon |
| iPhone/iPad (Safari) | Tap Share, then **Add to Home Screen**. The menu shows this hint on iOS |
| Desktop (Chrome, Edge) | The install icon in the address bar, or **Install app** in the menu |

The app is `display: fullscreen`, `orientation: landscape`, with a light background and theme colour that follow the dark/light switch.

## How offline works

* **`public/manifest.webmanifest`** names the app, sets display mode and icons. **Icons** are the pencil ring: `icon-192.png`, `icon-512.png`, a `maskable` one (full-bleed with the ring inside the safe zone, so Android can crop it to a circle) and `apple-touch-icon.png`.
* **`dist/sw.js`** is generated at build time by `vite.config.ts` from [`scripts/sw.template.js`](../scripts/sw.template.js). It lists every built file, caches them all on first load, and names the cache after a hash of the build, so each deploy gets a fresh cache and old ones are deleted.
  * Files: cache first.
  * The page: network first, but after 2.5 s it uses the cached copy, so it opens instantly on a bad connection and fully offline. Updates arrive the next time you are online.
  * The WebSocket is never intercepted.
* The service worker only registers in production builds (`npm run build`), not in `npm run dev`.
* The Play online button turns into **Offline** while the phone has no network.
* No dependencies were added for this.
* **Students work offline too:** the starter brains and the training worker are part of the cache, and everything a student learns is stored on the device.

To regenerate icons after changing the logo: `npm run logo && npm run icons` (the second step uses any installed Edge/Chrome to render the PNGs).

## Storage and cleanup

The app keeps two kinds of data on the device, and tidies both so it does not pile up:

| What | Where | How it stays small |
|---|---|---|
| **The app itself** (code, icons, starter brains) | the service worker's cache | one cache per build. When a new version installs, the old cache is **deleted automatically**, so there is only ever one copy |
| **Students** (brains, recorded matches, models of you) | IndexedDB | old brain versions and surplus or old recordings are pruned as they are saved, plus a full tidy-up at startup and after every lesson. See [ai.md](ai.md#storage-and-cleanup) for the exact rules |
| Small preferences (theme, health, server, effort) | localStorage | a few bytes |

You can see it and act on it in **Students → Storage**: how much student data there is (and what the browser reports for the whole app), **Tidy up** (clean now and report what was freed), **Forget my matches**, and **Erase all**. Student data is small: roughly 0.5 to 1 MB per fully grown student.

The app asks the browser to keep its data (`navigator.storage.persist()`). Browsers may otherwise clear a site's storage when a device is very low on space; installing the app to the home screen makes that much less likely. The Storage section says if the browser has not promised persistence.

If you want to remove the offline app files themselves, use the browser's own "clear site data" (or uninstall the app); the next visit simply downloads them again.

## Hosting

### The app on Vercel (static)

[`vercel.json`](../vercel.json) is included. Import the repo in Vercel (or `vercel` from the folder): it runs `vite build` and serves `dist/`. That is enough for local play, install and offline.

### Online play from a hosted app

The WebSocket server needs a host that allows long-running processes: your own laptop, a small VPS, or a container host such as Fly.io, Railway or Render. Run it there with `npm run play` (or `node --experimental-strip-types server/index.ts` after `npm run build`), then tell the app where it is, any one of:

* the **Online server** box in the menu (remembered on that phone)
* `?server=wss://your-server.example.com` in the URL (also remembered)
* `VITE_SERVER_URL=wss://your-server.example.com` when building

Use `wss://` (TLS) when the app is on https, because browsers block insecure sockets from secure pages. Hosts like Fly/Railway/Render give you TLS automatically. For two phones on the same WiFi, you do not need any of this: open `http://<laptop-ip>:3000` on both (see [networking.md](networking.md)).
