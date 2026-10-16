// Trains the starter personas (Ember, Stone, Echo) and writes them to public/personas/.
//
//   npm run train:base            full run (several minutes)
//   npm run train:base -- --quick  tiny run to check the pipeline
//
// For each persona:
//   1. DISTIL its teacher bot (hand-written logic, see src/ai/teachers.ts) into a network. The network
//      plays, the teacher labels every situation it reaches ("DAgger"), so the network learns to
//      recover from its own mistakes instead of only copying a perfect player.
//   2. PRACTISE in a league against the teachers and the other personas, learning from decisions that
//      beat expectations (reward-weighted regression). A new version is kept only if it does not get
//      worse than the old one, and it is gently pulled back toward its teacher so it keeps its style.
// Everything is seeded, so the same command gives the same brains.
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { STYLES } from '../src/content/ai.ts';
import type { StyleId } from '../src/content/ai.ts';
import { N_OUT } from '../src/ai/actions.ts';
import { duel, playMatch } from '../src/ai/arena.ts';
import type { Seat } from '../src/ai/arena.ts';
import { NET_SIZES, SCHEMA, newBrain } from '../src/ai/brain.ts';
import { Dataset } from '../src/ai/dataset.ts';
import { OBS_DIM } from '../src/ai/features.ts';
import { addLabelled, evaluate, practice, train } from '../src/ai/learn.ts';
import type { Opponent } from '../src/ai/learn.ts';
import type { Mlp } from '../src/ai/nn.ts';
import { MixPolicy, NetPolicy, RandomPolicy } from '../src/ai/policy.ts';
import { TEACHERS, TeacherPolicy } from '../src/ai/teachers.ts';
import { createRng } from '../src/core/rng.ts';

const quick = process.argv.includes('--quick');
const K = quick
  ? { rounds: 2, matches: 12, steps: 120, gens: 2, practiceMatches: 14, practiceSteps: 120, gate: 3, evalMatches: 8 }
  : { rounds: 8, matches: 48, steps: 450, gens: 10, practiceMatches: 60, practiceSteps: 350, gate: 5, evalMatches: 40 };

const IDS = ['ember', 'stone', 'echo'] as const;
type Id = (typeof IDS)[number];

const INFO: Record<Id, { name: string; blurb: string }> = {
  ember: { name: 'Ember', blurb: 'Rushes you down. Dashes in, jabs, and never lets up.' },
  stone: { name: 'Stone', blurb: 'Patient counter-fighter. Blocks, parries, then punishes.' },
  echo: { name: 'Echo', blurb: 'Adapts to you. Reads your habits and changes its game.' },
};

const t0 = performance.now();
const log = (msg: string): void => console.log(`[${((performance.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${msg}`);

const teacher = (id: Id): TeacherPolicy => new TeacherPolicy(TEACHERS[id]);
const teacherOpp = (id: Id): Opponent => ({ name: `teacher:${id}`, seat: () => ({ policy: teacher(id) }) });
const randomOpp: Opponent = { name: 'random', seat: () => ({ policy: new RandomPolicy() }) };
const netOpp = (name: string, net: Mlp): Opponent => ({ name, seat: () => ({ policy: new NetPolicy(net) }) });

// ── 1. distil each teacher into a network ──
function distill(id: Id, seed: number): { net: Mlp; ds: Dataset } {
  const rng = createRng(seed);
  const net = newBrain(seed);
  const labeler = new TeacherPolicy({ ...TEACHERS[id], noise: 0 });
  const acting = teacher(id);
  const ds = new Dataset(120_000);
  const pool: Opponent[] = [...IDS.map(teacherOpp), randomOpp];
  for (let r = 0; r < K.rounds; r++) {
    const pTeacher = r === 0 ? 1 : Math.pow(0.5, r); // hand the wheel over to the network round by round
    const learner = new MixPolicy(acting, new NetPolicy(net), pTeacher);
    for (let m = 0; m < K.matches; m++) {
      const opp = pool[m % pool.length];
      const swap = m % 2 === 1;
      const mine: Seat = { policy: learner, labeler, record: true };
      const res = playMatch(swap ? [opp.seat(), mine] : [mine, opp.seat()], { seed: seed * 1000 + r * 100 + m });
      const traj = res.traj[swap ? 1 : 0];
      if (traj) addLabelled(ds, traj);
    }
    const stats = train(net, ds, { steps: K.steps, batch: 128, lr: 2e-3 * Math.pow(0.85, r), labelSmoothing: 0.03, rng });
    log(`${id}: distil round ${r + 1}/${K.rounds}  data ${ds.size}  loss ${stats.loss.toFixed(3)}  matches teacher's move ${(stats.moveAcc * 100).toFixed(0)}%, button ${(stats.buttonAcc * 100).toFixed(0)}%`);
  }
  return { net, ds };
}

const brains = {} as Record<Id, Mlp>;
const teacherData = {} as Record<Id, Dataset>;
IDS.forEach((id, i) => {
  const { net, ds } = distill(id, 11 + i * 17);
  brains[id] = net;
  teacherData[id] = ds;
  const vs = duel({ policy: new NetPolicy(net) }, { policy: teacher(id) }, K.evalMatches, 4242);
  log(`${id}: distilled network vs its own teacher: ${(vs.rate * 100).toFixed(0)}% win rate`);
});

// keep each persona's starting point, to pull back toward while practising
const starts = {} as Record<Id, Float32Array[]>;
for (const id of IDS) starts[id] = brains[id].snapshot();

// ── 2. league practice ──
for (let g = 0; g < K.gens; g++) {
  for (const id of IDS) {
    const others = IDS.filter((o) => o !== id).map((o) => netOpp(`persona:${o}`, brains[o].clone()));
    const opponents: Opponent[] = [...IDS.map(teacherOpp), ...others, netOpp(`${id}:previous`, brains[id].clone()), randomOpp];
    const res = practice({
      net: brains[id],
      style: STYLES[id as StyleId],
      opponents,
      anchorData: teacherData[id],
      anchorFraction: 0.3,
      anchor: { weights: starts[id], lambda: 0.02 },
      seed: 9000 + g * 131 + IDS.indexOf(id) * 17,
      matches: K.practiceMatches,
      trainSteps: K.practiceSteps,
      gateMatches: K.gate,
    });
    log(`${id}: practice ${g + 1}/${K.gens}  ${res.accepted ? 'kept   ' : 'dropped'}  score ${(res.before * 100).toFixed(0)}% -> ${(res.after * 100).toFixed(0)}%  (${res.samples} decisions, ${(res.ms / 1000).toFixed(1)}s)`);
  }
}

// ── 3. report and save ──
const everyone: Opponent[] = [...IDS.map(teacherOpp), randomOpp, ...IDS.map((id) => netOpp(`persona:${id}`, brains[id]))];
const labels = everyone.map((o) => o.name.replace('teacher:', 't:').replace('persona:', 'p:'));
console.log('\nwin rate of ROW (persona) against COLUMN\n');
console.log(''.padEnd(10) + labels.map((l) => l.padStart(9)).join(''));
const report: Record<string, Record<string, number>> = {};
for (const id of IDS) {
  report[id] = {};
  let line = id.padEnd(10);
  for (const opp of everyone) {
    if (opp.name === `persona:${id}`) {
      line += '        -';
      continue;
    }
    const s = evaluate(new NetPolicy(brains[id]), [opp], K.evalMatches, 31337);
    report[id][opp.name] = Math.round(s.rate * 100);
    line += `${(s.rate * 100).toFixed(0)}%`.padStart(9);
  }
  console.log(line);
}

mkdirSync('public/personas', { recursive: true });
const index = {
  schema: SCHEMA,
  sizes: NET_SIZES,
  obsDim: OBS_DIM,
  outputs: N_OUT,
  trainedWith: quick ? 'quick' : 'full',
  personas: IDS.map((id) => {
    writeFileSync(`public/personas/${id}.bin`, new Uint8Array(brains[id].toBuffer()));
    return { id, ...INFO[id], style: id, file: `${id}.bin`, winRates: report[id] };
  }),
};
writeFileSync('public/personas/index.json', JSON.stringify(index, null, 2) + '\n');
log(`wrote public/personas/ (${IDS.length} brains, ${(brains.ember.paramCount * 4 / 1024).toFixed(0)} KB each)`);
