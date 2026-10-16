import { Agent } from '../../ai/agent.ts';
import { NetPolicy } from '../../ai/policy.ts';
import { packInputs } from '../../ai/replayPack.ts';
import { NullSource } from '../../core/index.ts';
import type { EventBus, InputSource } from '../../core/index.ts';
import type { Unsubscribe } from '../../core/events.ts';
import type { Hud } from '../hud.ts';
import { LocalSession } from '../session.ts';
import type { Session } from '../session.ts';
import type { Learner, LearnReport } from './learner.ts';
import type { PersonaStore } from './personas.ts';

/** What the controller needs from the rest of the app. */
export interface AiHost {
  bus: EventBus;
  hud: Hud;
  /** The human's controls (keyboard and/or touch). */
  humanInput: () => InputSource;
  hpScale: () => number;
  /** Start showing this session. `label` is 'persona' or 'watch'. */
  begin: (session: Session, label: 'persona' | 'watch') => void;
}

type Active =
  | { kind: 'persona'; id: string; name: string; session: LocalSession; agent: Agent; roundStart: number; pending: NetPolicy | null }
  | { kind: 'watch'; session: LocalSession; names: [string, string]; tally: [number, number] };

/**
 * Runs the two ways to use a student:
 *   PLAY    you against a persona. Every round is saved, and afterwards the persona studies it.
 *   WATCH   two personas fight each other (no learning), at up to 8x speed.
 * It owns the match for as long as it lasts and listens to the game's events to do its bookkeeping.
 */
export class AiController {
  private readonly host: AiHost;
  private readonly store: PersonaStore;
  private readonly learner: Learner;
  private active: Active | null = null;
  private offs: Unsubscribe[] = [];
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  /** Called whenever a persona's stats changed, so the Students screen can refresh. */
  onChanged: () => void = () => {};

  constructor(host: AiHost, store: PersonaStore, learner: Learner) {
    this.host = host;
    this.store = store;
    this.learner = learner;
    learner.onProgress = (id, note, f) => {
      if (this.active?.kind === 'persona' && this.active.id === id) this.say(`${this.active.name} is ${note}… ${Math.round(f * 100)}%`, 0);
    };
    learner.onDone = (r) => void this.learned(r);
    learner.onError = (id, message) => {
      console.warn('[hollow] learning failed', message);
      if (this.active?.kind === 'persona' && this.active.id === id) this.say('Could not learn this time', 4000);
    };
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  /** Stop listening and forget the current match (called when going back to the menu). */
  end(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.active = null;
    if (this.statusTimer) clearTimeout(this.statusTimer);
  }

  private say(text: string, ms: number): void {
    this.host.hud.setStatus(text);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    if (ms > 0) this.statusTimer = setTimeout(() => this.host.hud.setStatus(''), ms);
  }

  // ── play against a persona ──

  async play(id: string): Promise<void> {
    const row = await this.store.get(id);
    if (!row) return;
    const brain = await this.store.loadBrain(id);
    this.end();
    const session = new LocalSession(this.host.bus, this.host.humanInput(), new NullSource(), this.host.hpScale());
    const agent = new Agent({ slot: 1, getWorld: () => session.game.world, policy: new NetPolicy(brain, { temperature: row.settings.temperature }), settings: row.settings });
    session.game.router.attach(1, agent);
    this.host.begin(session, 'persona');
    this.host.hud.setNames('YOU', row.name);
    const a: Active = { kind: 'persona', id, name: row.name, session, agent, roundStart: 0, pending: null };
    this.active = a;
    this.offs.push(
      this.host.bus.on('ROUND_START', () => {
        // the very start of a round: use the newest brain if one arrived, and mark where the recording begins
        a.roundStart = Math.max(0, session.game.recorder.inputs.length - 1);
        if (a.pending) {
          a.agent.policy = a.pending;
          a.pending = null;
        }
      }),
      this.host.bus.on('KO', (e) => void this.roundOver(a, e.winner)),
    );
  }

  /** The persona's difficulty dials changed while it is playing: apply them straight away. */
  applySettings(id: string, settings: Agent['settings']): void {
    if (this.active?.kind === 'persona' && this.active.id === id) Object.assign(this.active.agent.settings, settings);
  }

  private async roundOver(a: Extract<Active, { kind: 'persona' }>, winner: number): Promise<void> {
    if (this.active !== a) return;
    const inputs = a.session.game.recorder.inputs.slice(a.roundStart);
    const personaResult = winner === 1 ? 'win' : winner === 0 ? 'loss' : 'draw';
    await this.store.saveReplay({
      personaId: a.id,
      at: Date.now(),
      humanSlot: 0,
      result: winner === 0 ? 'win' : winner === 1 ? 'loss' : 'draw',
      frames: inputs.length,
      data: packInputs(inputs),
    });
    await this.store.recordResult(a.id, personaResult);
    this.onChanged();
    this.learner.request(a.id);
  }

  private async learned(r: LearnReport): Promise<void> {
    this.onChanged();
    const a = this.active;
    if (a?.kind !== 'persona' || a.id !== r.personaId) {
      return;
    }
    if (r.accepted) {
      const brain = await this.store.loadBrain(a.id);
      a.pending = new NetPolicy(brain, { temperature: a.agent.settings.temperature });
      this.say(`${a.name} learned from your last round (${Math.round(r.before * 100)}% → ${Math.round(r.after * 100)}% against your style)`, 7000);
    } else {
      this.say(`${a.name} studied you but kept its old ideas`, 5000);
    }
  }

  // ── watch two personas ──

  async watch(aId: string, bId: string): Promise<void> {
    const [ra, rb] = await Promise.all([this.store.get(aId), this.store.get(bId)]);
    if (!ra || !rb) return;
    const [ba, bb] = await Promise.all([this.store.loadBrain(aId), this.store.loadBrain(bId)]);
    this.end();
    const session = new LocalSession(this.host.bus, new NullSource(), new NullSource(), this.host.hpScale());
    const agents = [ra, rb].map((row, i) => new Agent({ slot: i as 0 | 1, getWorld: () => session.game.world, policy: new NetPolicy(i === 0 ? ba : bb, { temperature: row.settings.temperature }), settings: row.settings }));
    session.game.router.attach(0, agents[0]);
    session.game.router.attach(1, agents[1]);
    this.host.begin(session, 'watch');
    this.host.hud.setNames(ra.name, rb.name);
    const a: Active = { kind: 'watch', session, names: [ra.name, rb.name], tally: [0, 0] };
    this.active = a;
    this.say(`${ra.name} vs ${rb.name}`, 0);
    this.offs.push(
      this.host.bus.on('KO', (e) => {
        if (e.winner === 0 || e.winner === 1) a.tally[e.winner]++;
        this.say(`${a.names[0]} ${a.tally[0]} – ${a.tally[1]} ${a.names[1]}`, 0);
      }),
    );
  }

  /** 1, 2, 4 or 8 times normal speed (watch mode only). */
  setSpeed(speed: number): void {
    if (this.active?.kind === 'watch') this.active.session.speed = speed;
  }
}
