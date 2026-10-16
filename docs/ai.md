# Students: AI opponents that learn from you

A **student** is an AI persona that lives on your device. You can play against it, tweak how hard it plays, and watch it fight other students. After every round it studies what you did and practises against a model of you, so it slowly adapts to how *you* play. It works offline: no server, no cloud, nothing leaves the device.

Three students come with the game: **Ember** (rushes you down), **Stone** (blocks, parries, punishes) and **Echo** (reads your habits and adapts). They can be renamed, trained, copied, exported and deleted. You can make more from any starter.

## Using it

Menu → **Play a student**, or **Watch AI vs AI**.

The Students screen shows **one student at a time**: use the ◀ ▶ buttons (or swipe the card, or the arrow keys, or tap a dot) to flip through them, change the difficulty with one tap, then press **Play**.

| On a student card | What it does |
|---|---|
| **Difficulty** (Easy, Normal, Hard, Brutal) | Four presets that set both dials below in one tap. The label shows *Custom* if you move a dial away from them. |
| **Randomness** (0–100%) | The share of its decisions replaced by a random but sensible action. A little makes it less predictable and a bit sloppy. |
| **Reaction** (0–400 ms) | How long after it decides before its hands act, like a person's reaction time. This is the main handicap. |
| **Play** | Fight it. Every round is recorded and studied afterwards. |
| **More** | *Undo last lesson* (go back one brain version), *Reset* (back to its starting brain), *Export* (a `.hollow.json` file), *Delete*. |

Below the cards: **Watch two students fight** (pick any two, speed 1×–8×, a running score), **New student · import** (start from a starter, or import a file), **Storage** (see [Storage](#storage-and-cleanup)), and **Learning effort** (Off / Quick 8 s / Normal 20 s / Deep 1 min of thinking after each round).

Matches also have a **Health** setting in the main menu (Normal 1000 / Long 2000 / Epic 3000 / Marathon 5000), which applies to students too.

## How a student plays

Every **4 frames** (15 times a second, `AI.decisionFrames`) it makes one decision:

1. **Look.** It sees the fight, as it is right now, as a list of about 125 numbers ([`ai/features.ts`](../src/ai/features.ts)).
2. **Work out what is possible.** A legality mask removes anything the game would ignore (attacking while knocked down, the ultimate without energy). Then the ground rules remove actions it has repeated too often.
3. **Choose.** Its network picks a *move* (7 choices) and a *button* (6 choices). Unless the Randomness dial replaces the choice with a random one.
4. **Play it out** as real button presses over the next 4 frames, through the same input router as a keyboard, **`reaction` frames later** (its reaction time). The game cannot tell it from a person.

### What it can see

Only what a player could see on screen. Everything is **relative to facing**, so "in front" and "behind" never depend on which side of the screen it is on, and one lesson works from both sides.

| Group | Examples |
|---|---|
| **Distance and direction** | signed distance to the opponent (front or behind), near/mid/far buckets, am I facing them, are they facing me |
| **Height and speed** | both heights, vertical speed, horizontal speed toward/away |
| **The walls** | room behind me, room behind them (corner awareness) |
| **What each fighter is doing** | state, current move, which phase (startup/active/recovery) and how far into it |
| **Timing** | frames until each fighter can act, frames until a move becomes active |
| **Reach** | for each of my moves, how far inside (or outside) its range the opponent is; and the same for the opponent's current move |
| **Meters** | health, guard, energy of both; combos |
| **Habits** | what the opponent has been doing over the last 12 decisions, and what I did last |

That last group is how a student notices things like "always dashes in and jabs".

### Ground rules

Actions the student may not repeat too many times in a row, however much it likes them (`GUARDRAILS` in [`content/ai.ts`](../src/content/ai.ts)). Once a limit is hit the action is switched off for a few decisions. They apply in training as well, so the student learns to live with them.

| Rule | Limit | Then off for |
|---|---|---|
| no bunny-hopping (jumps) | 1 in a row | 5 decisions |
| dash for a bit, not forever | 16 | 3 |
| no jab spam | 6 | 2 |
| no heavy spam | 2 | 3 |
| ultimate is special | 1 | 8 |
| no endless turtling (guard) | 14 | 3 |
| no endless crouching | 12 | 3 |
| no endless retreating | 12 | 4 |
| no standing still | 18 | 2 |

Rules only ever *remove* options. If one would leave nothing to do, it stands down for that decision. The same applies to the Randomness dial: random choices are legal ones, weighted toward everyday actions, and come in short runs (about 2 decisions), so random play looks like flailing, not jitter. The long-run share of random decisions matches the slider (this is tested).

## Difficulty

The two dials do different jobs, and it matters which one you turn:

* **Reaction** is the big one. The brains win by reflex: they block a 4-frame jab *as it starts*. Every frame of delay costs them dearly, so reaction time is a smooth, wide-range handicap.
* **Randomness** is a light seasoning. On its own it weakens a student gently, but it quickly makes play look like flailing, so the presets use it sparingly.

The presets were calibrated by playing the students against a *human stand-in* (a bot with a 200 ms reaction that makes 20% sloppy choices; people are usually weaker than a bot, so this is a fairly tough test):

| Preset | Randomness | Reaction | Student wins vs the stand-in |
|---|---|---|---|
| **Easy** | 35% | 17 frames (283 ms) | about 18% |
| **Normal** | 20% | 12 frames (200 ms) | about 64% |
| **Hard** (default) | 10% | 8 frames (133 ms) | about 91% |
| **Brutal** | 0% | 0 frames | 100% |

(`DIFFICULTY` in [`content/ai.ts`](../src/content/ai.ts).) Without any handicap, the students beat the stand-in 100% of the time, which matches how tough they feel to play.

*A finding worth knowing:* an earlier version fed the student a stale picture of the game to model "reaction". These brains, trained on a current picture, fell apart (3 frames of staleness took a student from 60% to 13% wins against a bot). Delaying the *hands* instead, while the brain still sees the present, behaves smoothly and is what is used now. Both versions were measured before choosing.

## How a student learns

After every round, in a background worker (so the game stays smooth), within the Learning-effort time budget:

1. **Study you.** Your recent matches (the last 24, plus a few older ones as a reminder) are replayed through the deterministic sim, and what you did at every decision point becomes an example. Because the sim is deterministic, this reproduces exactly what you saw. Recordings are stored as **inputs only** (run-length packed, a few KB each), so if the game's features ever change, old recordings are simply re-read.
2. **Model you.** A small network, the *clone*, is trained to copy how you play. It is saved with the student.
3. **Practise.** The student plays many fast headless matches (a few milliseconds each) against your clone, a teacher bot, its previous self and a random bot. It learns from the decisions that turned out **better than expected**, which is advantage-weighted regression, a simple and stable form of reinforcement learning. Rewards are damage dealt and taken, parries and blocks, a small push to stay engaged, and a big bonus for winning, tuned per style (Ember is paid more for pressure, Stone for clean defence).
4. **Keep it only if it did not get worse.** The new version plays the old one (same opponents, same seeds). If it scores worse, it is thrown away. This is what stops one bad session from ruining a student.

What keeps it from over-fitting to you or forgetting how to fight:

- **Anchor.** Updates are pulled gently back toward the student's *starting* brain, so its personality survives.
- **Your data stays in the mix.** A fraction of every training batch is your own play.
- **Recent plus rehearsal.** Mostly recent matches, with a few old ones mixed in.
- **Balanced examples.** Standing still is common and teaches little, so rare actions are weighted up.
- **It samples, it does not always pick its favourite,** so you cannot beat it by finding one fixed pattern.
- **Versions.** Every accepted lesson is a saved brain version, so *Undo last lesson* is always available.

The brain is a small network (about 20,000 weights, 75 KB): 2 hidden layers (96 and 64), no GPU, no library. For a model this size plain typed-array loops beat any library's startup and dispatch overhead, and the same code runs in a phone's browser, a Web Worker, Node and the tests.

## The starter personas

Built by `npm run train:base` ([`scripts/train-base.mts`](../scripts/train-base.mts)):

1. **Teacher bots** ([`ai/teachers.ts`](../src/ai/teachers.ts)) are hand-written fighters that know every move's reach and timing. They defend (guard, timed parries, crouch-guard against lows), punish openings with a move that fits the window, finish strings, control distance and use the ultimate. Each has a style (a preferred range and how often it pokes, guards, dashes in, jumps in).
2. **Distil** each teacher into a network with DAgger: the *network* plays and the *teacher* labels every situation it reaches, so the network learns to recover from its own mistakes instead of only copying a perfect player.
3. **League practice**: 10 generations of the three students practising against the teachers and each other with the same learn-and-gate loop as above.

The full run (about 21 minutes on a desktop) produced these win rates **under the current rules, including the fair get-up rule** (40 matches each, sides swapped, full strength):

| | vs Ember bot | vs Stone bot | vs Echo bot | vs random | vs Ember | vs Stone | vs Echo |
|---|---|---|---|---|---|---|---|
| **Ember** | 63% | 34% | 50% | 88% | – | 25% | 48% |
| **Stone** | 88% | 65% | 68% | 85% | 84% | – | 66% |
| **Echo** | 85% | 40% | 63% | 80% | 60% | 39% | – |

Stone is the strongest, Ember and Echo trade blows, and they are distinct. Default settings in the game are the **Hard** preset, so they play softer than this. The numbers are also in `public/personas/index.json`.

**The fair get-up rule** (a fighter is held back while the other is down; see [combat-model.md](combat-model.md#3b-fair-get-up)) changed the game after the first training. The students were re-measured and still played well, so they did not *need* retraining; a fresh run under the new rule came out about equal (the average over every matchup was within 1%), and those are the brains shipped now. Students you already have keep their own brains. Recordings made before the rule are discarded by the tidy-up, because they would replay differently now.

To change a persona's style, edit its teacher or its reward style (`STYLES`) and re-run the script. Same seeds give the same brains.

## Storage and cleanup

Everything is stored in the browser's **IndexedDB** (through Dexie) on the device.

| What | Size | Kept |
|---|---|---|
| A brain version | ~75 KB | the starting brain, plus the newest 5 |
| A recorded match | a few KB | the newest 24, plus a few older ones for rehearsal (never more than 48) |
| A model of you (clone) | ~75 KB | 1 per student |

So a student costs roughly 0.5 to 1 MB when fully grown, and the whole thing stays in the low megabytes (a test run with 4 students, 9 brains and 18 matches used 766 KB).

**Automatic tidying:** old brain versions and surplus recordings are pruned as they are saved; a full tidy-up runs at startup and after every lesson. It removes brain versions beyond the keep window, brains made for an older version of the game, recordings beyond the study window (and any older than 90 days), and leftovers of students you deleted. It never touches the current brain, the starting brain, or matches a student is still studying.

**By hand,** in *Students → Storage*: it shows how much student data is stored (and what the browser says the whole app uses), with three buttons: **Tidy up** (run the clean-up now and say what it freed), **Forget my matches** (delete the recordings; students keep their brains) and **Erase all** (delete every student and start over with fresh starters). Deleting one student removes its brains, recordings and model of you.

The app asks the browser to keep this data (`navigator.storage.persist()`); installing it as an app makes that far more likely to be granted. The offline app files are cached separately by the service worker, and each new version deletes the old one's cache automatically (see [mobile-and-pwa.md](mobile-and-pwa.md)).

If the game changes in a way that makes saved brains meaningless (different inputs or outputs), the brain's fingerprint no longer matches. The student is quietly reset to its starting brain, marked so, and its recordings are kept so it can relearn.

## Offline

The starter brains, the training worker and the whole app are cached by the service worker, and students are stored locally, so students work with **no internet**. This was tested by installing the app, shutting the server down, and then creating a student, playing it, letting it learn and tidying storage. Only *Play online* needs a network.

## Where the code is

| | |
|---|---|
| `src/ai/` | pure and portable (no DOM, runs in browser, worker, Node, tests) |
| `actions.ts` | the 7 moves × 6 buttons, turning choices into presses and back, the legality mask |
| `features.ts` | what it sees; the schema fingerprint |
| `nn.ts` | the network, backprop, AdamW, saving |
| `policy.ts`, `agent.ts`, `guardrails.ts` | how decisions are made: policies, the agent (an `InputSource`), the Randomness dial, ground rules |
| `arena.ts` | headless matches with rewards |
| `learn.ts`, `personaLearn.ts` | imitation, reinforcement, the gate, and the after-a-round pipeline |
| `teachers.ts` | the scripted fighters |
| `src/client/ai/` | the phone side: Dexie storage (`db.ts`, `personas.ts`), the worker (`trainer.worker.ts`, `learner.ts`), the matches (`controller.ts`) and the Students screen (`ui.ts`) |
| `src/content/ai.ts` | every tunable: decision rate, reaction range, ground rules, reward styles, how much is kept |

## Limits, honestly

- A ~20k-weight network trained on a handful of your rounds is a **good, adaptive, human-flavoured opponent, not a superhuman one.** It needs tens of rounds before it clearly reflects your habits.
- How well it adapts depends on how well the clone captures you, and that needs variety in your play.
- The Learning-effort budgets are time-boxed, so a slower phone does less in the same time. Speeds on a real phone have **not** been measured yet; on this desktop a match takes tens of milliseconds and a Quick lesson comfortably finishes.
- Students only play single player for now. Online matches are between people.
- The practice cap is 60 s of fighting; a timed-out practice match is judged on remaining health.
