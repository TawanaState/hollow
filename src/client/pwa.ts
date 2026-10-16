/**
 * Everything that makes hollow behave like an installed app on a phone:
 * offline caching, the install button, fullscreen, and keeping the screen awake.
 */

/** Running as an installed app (home-screen icon), not in a browser tab? */
export const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Cache the game for offline use. Only in production builds (dev would fight hot reload). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[hollow] offline cache unavailable', e));
  });
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Show "Install app" when the browser offers it (Android/desktop Chrome and Edge). iOS Safari
 * has no install prompt, so there we show the Share -> Add to Home Screen hint instead.
 */
export function setupInstall(button: HTMLElement, hint: HTMLElement): void {
  if (isStandalone()) return;
  let deferred: InstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    button.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    button.hidden = true;
  });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) {
    hint.textContent = 'To install: tap Share, then “Add to Home Screen”.';
    hint.hidden = false;
  }
}

/** Fullscreen toggle (and try to lock landscape where the browser allows it). */
export function setupFullscreen(button: HTMLElement): { toggle: () => void } {
  const root = document.documentElement;
  const supported = document.fullscreenEnabled && !isStandalone();
  button.hidden = !supported;
  const toggle = (): void => {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else {
      void root.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        const orientation = screen.orientation as unknown as { lock?: (o: string) => Promise<void> };
        orientation.lock?.('landscape').catch(() => {});
      });
    }
  };
  button.addEventListener('click', toggle);
  return { toggle };
}

/** Stop the phone dimming mid-fight. Re-acquired when the tab comes back. */
export function keepAwake(): void {
  const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock;
  if (!wl) return;
  const grab = (): void => void wl.request('screen').catch(() => {});
  grab();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') grab();
  });
}
