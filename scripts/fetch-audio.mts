// Downloads the CC0 sound packs we use, picks the files we need, and writes them to public/audio/
// together with a manifest (group name -> variants) and the credits.
//
//   npm run audio
//
// The files are committed, so you only need this to change the selection. Every pack is CC0
// (public domain, https://creativecommons.org/publicdomain/zero/1.0/), made by Kenney (kenney.nl).
// Attribution is not required but is given in public/audio/CREDITS.txt anyway.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const PACKS = {
  impact: { url: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip', name: 'Impact Sounds', page: 'https://kenney.nl/assets/impact-sounds' },
  scifi: { url: 'https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip', name: 'Sci-fi Sounds', page: 'https://kenney.nl/assets/sci-fi-sounds' },
  rpg: { url: 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip', name: 'RPG Audio', page: 'https://kenney.nl/assets/rpg-audio' },
  ui: { url: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip', name: 'Interface Sounds', page: 'https://kenney.nl/assets/interface-sounds' },
  voice: { url: 'https://opengameart.org/sites/default/files/kenney_voiceoverFighter.zip', name: 'Voiceover Pack: Fighter', page: 'https://opengameart.org/content/voiceover-pack-fighter-40-taunts' },
} as const;
type Pack = keyof typeof PACKS;

/** group name -> [pack, file names inside the pack's Audio folder (no extension)]. Variants are picked at random in game. */
const GROUPS: Record<string, [Pack, string[]]> = {
  // hits, by weight
  'hit-light': ['impact', ['impactGeneric_light_000', 'impactGeneric_light_001', 'impactGeneric_light_002', 'impactGeneric_light_003', 'impactGeneric_light_004']],
  'hit-medium': ['impact', ['impactPunch_medium_000', 'impactPunch_medium_001', 'impactPunch_medium_002', 'impactPunch_medium_003', 'impactPunch_medium_004']],
  'hit-heavy': ['impact', ['impactPunch_heavy_000', 'impactPunch_heavy_001', 'impactPunch_heavy_002', 'impactPunch_heavy_003', 'impactPunch_heavy_004']],
  // layers that add weight and bite to hits
  'body-soft': ['impact', ['impactSoft_medium_000', 'impactSoft_medium_001', 'impactSoft_medium_002']],
  'body-heavy': ['impact', ['impactSoft_heavy_000', 'impactSoft_heavy_001', 'impactSoft_heavy_002']],
  'crack-medium': ['impact', ['impactPlate_medium_000', 'impactPlate_medium_001', 'impactPlate_medium_002']],
  'crack-heavy': ['impact', ['impactPlate_heavy_000', 'impactPlate_heavy_001', 'impactPlate_heavy_002']],
  // blocks, guard breaks, parries
  'clank-light': ['impact', ['impactMetal_light_000', 'impactMetal_light_001', 'impactMetal_light_002']],
  'clank-medium': ['impact', ['impactMetal_medium_000', 'impactMetal_medium_001', 'impactMetal_medium_002']],
  'clank-heavy': ['impact', ['impactMetal_heavy_000', 'impactMetal_heavy_001', 'impactMetal_heavy_002']],
  'glass-heavy': ['impact', ['impactGlass_heavy_000', 'impactGlass_heavy_001', 'impactGlass_heavy_002']],
  'bell': ['impact', ['impactBell_heavy_000', 'impactBell_heavy_001', 'impactBell_heavy_002']],
  'field': ['scifi', ['forceField_000', 'forceField_001']],
  // the ground
  'wood-heavy': ['impact', ['impactWood_heavy_000', 'impactWood_heavy_001', 'impactWood_heavy_002']],
  'step': ['impact', ['footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002', 'footstep_concrete_003', 'footstep_concrete_004']],
  'boom': ['scifi', ['lowFrequency_explosion_000', 'lowFrequency_explosion_001']],
  'crunch': ['scifi', ['explosionCrunch_000', 'explosionCrunch_001']],
  // movement
  'swish': ['rpg', ['knifeSlice', 'knifeSlice2', 'drawKnife1']],
  'chop': ['rpg', ['chop']],
  'cloth': ['rpg', ['cloth1', 'cloth2', 'cloth3', 'cloth4']],
  'zap': ['scifi', ['laserLarge_000', 'laserLarge_001', 'laserSmall_000']],
  // interface
  'ui-click': ['ui', ['click_001', 'click_002', 'click_003']],
  'ui-select': ['ui', ['select_001', 'select_002']],
  'ui-confirm': ['ui', ['confirmation_001', 'confirmation_002']],
  'ui-back': ['ui', ['back_001']],
  'ui-open': ['ui', ['open_001']],
  'ui-close': ['ui', ['close_001']],
  'ui-tick': ['ui', ['tick_001']],
  'ui-toggle': ['ui', ['toggle_001']],
  'ui-error': ['ui', ['error_001']],
  // the announcer
  'say-fight': ['voice', ['fight']],
  'say-round-1': ['voice', ['round_1']],
  'say-round-2': ['voice', ['round_2']],
  'say-round-3': ['voice', ['round_3']],
  'say-round-4': ['voice', ['round_4']],
  'say-round-5': ['voice', ['round_5']],
  'say-final-round': ['voice', ['final_round']],
  'say-combo': ['voice', ['combo']],
  'say-flawless': ['voice', ['flawless_victory']],
  'say-winner': ['voice', ['winner']],
  'say-you-win': ['voice', ['you_win']],
  'say-you-lose': ['voice', ['you_lose']],
  'say-tie': ['voice', ["it's_a_tie"]],
};

const OUT = 'public/audio';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const packs = new Map<Pack, Record<string, Uint8Array>>();
for (const key of Object.keys(PACKS) as Pack[]) {
  process.stdout.write(`downloading ${PACKS[key].name}... `);
  const res = await fetch(PACKS[key].url);
  if (!res.ok) throw new Error(`could not download ${PACKS[key].url} (${res.status}). Kenney sometimes moves files: get the new link from ${PACKS[key].page}`);
  packs.set(key, unzipSync(new Uint8Array(await res.arrayBuffer())));
  console.log('ok');
}

const manifest: Record<string, string[]> = {};
let bytes = 0;
for (const [group, [pack, names]] of Object.entries(GROUPS)) {
  const files = packs.get(pack)!;
  manifest[group] = [];
  names.forEach((name, i) => {
    const entry = Object.keys(files).find((p) => p.replace(/\\/g, '/').endsWith(`/${name}.ogg`) || p === `${name}.ogg`);
    if (!entry) throw new Error(`${pack}: ${name}.ogg not found in the pack`);
    const out = names.length === 1 ? `${group}.ogg` : `${group}-${i + 1}.ogg`;
    writeFileSync(`${OUT}/${out}`, files[entry]);
    manifest[group].push(out);
    bytes += files[entry].length;
  });
}
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

const used = new Set(Object.values(GROUPS).map(([p]) => p));
writeFileSync(
  `${OUT}/CREDITS.txt`,
  [
    'Sound effects and voice lines by Kenney (https://kenney.nl), released under Creative Commons CC0 1.0',
    '(public domain, https://creativecommons.org/publicdomain/zero/1.0/). Credit is not required, but is given with thanks.',
    '',
    ...[...used].map((p) => `- ${PACKS[p].name}: ${PACKS[p].page}`),
    '',
    'Selected files are copied unmodified and renamed (see manifest.json). Everything else in the game\'s sound is synthesised in code.',
    '',
  ].join('\n'),
);
console.log(`\nwrote ${Object.values(manifest).flat().length} files in ${Object.keys(manifest).length} groups, ${(bytes / 1024).toFixed(0)} KB, to ${OUT}/`);
