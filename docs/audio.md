# Sound

The game's sound is **recorded sounds layered with synthesised bass, mixed like a real game**: every sound is built from layers, picks a random variant and pitch each time, is placed left or right where it happens on screen, and goes through a small mixing desk with reverb, ducking and a limiter. There is also a full announcer.

Hear it all at **`/sounds.html`** (run `npm run dev`): a button for every sound, a combo-count and pan control, and a button that plays a whole scripted fight so you can judge the weight of each hit in context.

## Where the sounds come from

All recordings are **CC0 (public domain)** by [Kenney](https://kenney.nl), so there is nothing to attribute or license (credit is given anyway in [`public/audio/CREDITS.txt`](../public/audio/CREDITS.txt)):

| Pack | Used for |
|---|---|
| [Impact Sounds](https://kenney.nl/assets/impact-sounds) | punches (light, medium, heavy), soft body thuds, plate cracks, metal clanks, glass, bells, wood, footsteps |
| [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | the low "boom" under big hits and the K.O., explosions, energy zaps and shields (parry, ultimate) |
| [RPG Audio](https://kenney.nl/assets/rpg-audio) | blade swishes for attacks, cloth rustle for dashes and jumps |
| [Interface Sounds](https://kenney.nl/assets/interface-sounds) | menu clicks, ticks, confirms, back, open/close |
| [Voiceover Pack: Fighter](https://opengameart.org/content/voiceover-pack-fighter-40-taunts) | the announcer: "Round 1", "Fight!", "Combo", "Flawless victory", "You win", "You lose", "Winner", "It's a tie" |

93 files, about 1 MB, are copied unmodified into `public/audio/` (and so into the offline cache). Everything else you hear is synthesised in code. To change the selection edit [`scripts/fetch-audio.mts`](../scripts/fetch-audio.mts) and run `npm run audio`: it downloads the packs, picks the files, renames them, and writes `manifest.json` (group name → variants) and the credits. The files are committed, so you only need that to change the selection.

## What makes a hit feel heavy

Every sound is a recipe in [`content/sfx.ts`](../src/content/sfx.ts) with up to three kinds of layer:

| Layer | What it is |
|---|---|
| `samples` | recorded sounds, from a **group** of variants. The game picks one at random (never the same twice in a row) and plays it at a random pitch within a range |
| `body` | synthesised low end: sub-bass thumps, risers. This is what gives heavy hits their chest-weight |
| `fallback` | a fully synthesised version, used only if the recordings could not be loaded (so the game is never silent) |

The tiers stack up. A **light** hit is a sharp tap with a little thud. A **heavy** hit adds a body thud, a plate crack and a sub-bass sweep (85→34 Hz) with a reverb tail. A **crush** hit (the ultimate, or a counter-hit that kills) layers a pitched-down heavy punch, a plate crack, a metal clank, a low explosion, a hint of glass, and a 62→24 Hz sub-boom, with a big reverb and a short "duck" that makes everything else dip so the hit lands. Measured loudness climbs the same way (RMS: light −31 dB, medium −26, heavy −22, crush −19, K.O. −17).

Other things the engine does, all from the recipe:

* **Combos climb in pitch.** Each hit in a combo plays a little higher and harder (up to +35%), so a string builds.
* **Stereo placement.** Sounds are panned to where they happen relative to the camera. Whooshes, round sounds and UI are centred.
* **Reverb** on big moments, from an impulse response generated in code (`reverb` on a recipe or layer, 0 to 1).
* **Ducking.** `duck` makes the rest of the mix dip briefly: on crush hits, parries, the announcer.
* **Muffle.** The K.O. closes the whole mix's top end like ringing ears (`muffle`), with a faint high tone over a deep sub-boom. The announcer is not muffled.
* **A limiter chain.** A gentle compressor (slow attack so the punch of each hit gets through) and a soft clip. The worst case, every big sound at once, peaks at 0.95, so it never clips.
* **Voice cut-off.** A new announcer line cuts the previous one, so "Fight!" is never talked over by a long "Round 4".

## When things play

[`client/director.ts`](../src/client/director.ts) is the one place that maps game events to sounds (and effects):

| Event | Sound |
|---|---|
| hit | `hit.<tier>`, plus `counter` ping on a counter-hit; pitch follows the combo |
| block / parry / guard break | `block.<tier>` (metal clank), `parry` (bell ring and shield), `guardBreak` (glass and boom) |
| a move starts | `skill.<tier>`: a blade swish that gets lower and longer with the move's weight; the ultimate adds a zap and a riser |
| dash, jump, landing, knockdown | cloth, foot-push, steps, a body thud |
| K.O. | the big one: boom, crunch, clank, sub-bass, ringing, reverb, muffle, then the announcer after about 1.4 s |
| round start / go | a drum hit and rising tension; "Round N" then "Fight!" with a heavy hit |
| menus | click, tick (sliders), select (drop-downs), confirm, back, open/close, error (delete) |

And three sounds nothing announces, in [`client/foley.ts`](../src/client/foley.ts): **footsteps** (on each stride, faster for dashing), a **chime** when your ultimate is ready, and a **heartbeat** that quickens as someone nears K.O.

**The announcer** says "Round N" (counted from the score), "Fight!", "Combo" at the 5th hit of a combo (not more often than every 9 seconds), and at the K.O.: "You win" / "You lose" in single-player, otherwise "Flawless victory" if the winner took no damage, else "Winner", or "It's a tie".

## Settings

In the main menu: **Sound** (Full, No announcer, Off) and **Volume**. The ♪ button and **M** mute. They are remembered. Pausing the game silences it.

## Adding or changing a sound

1. Pick (or add) a sample group. To add recordings, put them in the `GROUPS` table in `scripts/fetch-audio.mts` and run `npm run audio`.
2. Edit its recipe in `content/sfx.ts`: layer gains, `rate` ranges, `delay` (in F), `reverb`, `duck`.
3. Open `/sounds.html` and click it. For a new key, also add it to `client/director.ts` (events) or call `audio.play('key')`.

Keep `body` layers on anything that should feel heavy; keep a `fallback` on anything important.

## Verifying it (what was measured)

The sounds were checked by rendering each one offline in a real browser and measuring it: all 93 recordings decode, loudness climbs with the hit tier, the heavy sounds are dominated by the low end (over 80% of their energy is under about 200 Hz), nothing clips, quiet sounds (footsteps, UI) are audible, and the K.O. really does close the top end. The tests check the files themselves (real Ogg audio, under the size budget, every group a recipe uses exists, nothing shipped unused, credits present) and the event-to-sound mapping. **How it sounds is for your ears**: use the sound board and tell me what to change.

## Notes and limits

* Recordings are **Ogg Vorbis**, which Chrome, Edge, Firefox and Android play. Older Safari versions may not decode them: the game then falls back to the synthesised sounds instead of going silent.
* Browsers only allow sound after a tap or key press, so the very first click makes no sound.
* If you want a different feel (grittier, more arcade, more cinematic), swap the sample groups for other CC0 recordings and re-tune the recipe gains on the sound board.
