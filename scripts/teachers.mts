// Round-robin report for the scripted teacher bots: who beats whom, and how fights end.
//   node --experimental-strip-types scripts/teachers.mts [matches]
import { duel, playMatch } from '../src/ai/arena.ts';
import { IdlePolicy, RandomPolicy } from '../src/ai/policy.ts';
import type { Policy } from '../src/ai/policy.ts';
import { TEACHERS, TeacherPolicy } from '../src/ai/teachers.ts';

const matches = Number(process.argv[2] ?? 40);
const fighters: Record<string, Policy> = {
  ember: new TeacherPolicy(TEACHERS.ember),
  stone: new TeacherPolicy(TEACHERS.stone),
  echo: new TeacherPolicy(TEACHERS.echo),
  random: new RandomPolicy(),
  idle: new IdlePolicy(),
};
const names = Object.keys(fighters);
console.log(`win rate of ROW against COLUMN (${matches} matches each, sides swapped)\n`);
console.log(''.padEnd(8) + names.map((n) => n.padStart(8)).join(''));
for (const a of names) {
  const row = names.map((b) => (a === b ? '   -    ' : (duel({ policy: fighters[a] }, { policy: fighters[b] }, matches, 1000).rate * 100).toFixed(0).padStart(7) + '%'));
  console.log(a.padEnd(8) + row.join(''));
}
let frames = 0;
let kos = 0;
const N = 30;
for (let i = 0; i < N; i++) {
  const r = playMatch([{ policy: fighters.ember }, { policy: fighters.stone }], { seed: i });
  frames += r.frames;
  if (r.winner !== -1 && (r.hp[0] === 0 || r.hp[1] === 0)) kos++;
}
console.log(`\nember vs stone: avg ${(frames / N / 60).toFixed(1)}s, ${kos}/${N} ended by K.O. (rest timed out)`);
