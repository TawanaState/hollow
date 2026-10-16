// Win-rate table for the shipped starter personas under the CURRENT game rules.
// Run it after changing the rules to see whether they need retraining.
//   npm run eval:base [matches]
import { readFileSync } from 'node:fs';
import { brainFromBuffer } from '../src/ai/brain.ts';
import { evaluate } from '../src/ai/learn.ts';
import type { Opponent } from '../src/ai/learn.ts';
import { NetPolicy, RandomPolicy } from '../src/ai/policy.ts';
import { TEACHERS, TeacherPolicy } from '../src/ai/teachers.ts';

const matches = Number(process.argv[2] ?? 40);
const ids = ['ember', 'stone', 'echo'] as const;
const load = (id: string) => {
  const b = readFileSync(`public/personas/${id}.bin`);
  return brainFromBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const brains = Object.fromEntries(ids.map((id) => [id, load(id)]));
const opponents: Opponent[] = [
  ...ids.map((id) => ({ name: `bot:${id}`, seat: () => ({ policy: new TeacherPolicy(TEACHERS[id]) }) })),
  { name: 'random', seat: () => ({ policy: new RandomPolicy() }) },
  ...ids.map((id) => ({ name: `p:${id}`, seat: () => ({ policy: new NetPolicy(brains[id]) }) })),
];
console.log(`win rate of ROW (persona) against COLUMN, ${matches} matches each, full strength\n`);
console.log(''.padEnd(8) + opponents.map((o) => o.name.padStart(10)).join(''));
for (const id of ids) {
  let line = id.padEnd(8);
  for (const o of opponents) line += o.name === `p:${id}` ? '         -' : `${(evaluate(new NetPolicy(brains[id]), [o], matches, 31337).rate * 100).toFixed(0)}%`.padStart(10);
  console.log(line);
}
