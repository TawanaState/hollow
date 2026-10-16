import type { Audio } from './audio.ts';

/** Click, tick and confirm sounds for every button, slider and drop-down in the menus. */
export function setupUiSounds(audio: Audio): void {
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const id = b.id;
    if (id === 'ai-back' || id === 'btn-menu') audio.play('ui.back');
    else if (id === 'btn-theme' || id === 'btn-sound' || id === 'btn-full') audio.play('ui.toggle');
    else if (b.classList.contains('primary') || id.startsWith('go-') || id === 'watch-go' || id === 'new-go') audio.play('ui.confirm');
    else if (b.dataset.act === 'delete' || id === 'storage-wipe') audio.play('ui.error');
    else audio.play('ui.click');
  });
  document.addEventListener('input', (e) => {
    if ((e.target as HTMLInputElement).type === 'range') audio.play('ui.tick');
  });
  document.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') audio.play('ui.select');
  });
  document.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement;
      if (d.tagName === 'DETAILS') audio.play(d.open ? 'ui.open' : 'ui.close');
    },
    true,
  );
}
