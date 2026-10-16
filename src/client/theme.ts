/**
 * Light/dark theme. Everything visual reads CSS variables (see src/style.css), so
 * switching is just flipping `data-theme` on <html>. No JS touches individual colours.
 */
export type Theme = 'light' | 'dark';

const KEY = 'hollow.theme';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Colour the phone's status bar / app frame to match. */
function syncThemeColor(theme: Theme): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#07070a' : '#f6f6f8');
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  syncThemeColor(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: just don't persist */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Call once at startup: ?theme=light|dark, else the saved choice, else the OS preference. */
export function initTheme(): void {
  const query = new URLSearchParams(location.search).get('theme');
  const fromQuery = query === 'light' || query === 'dark' ? query : null;
  const fallback: Theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = fromQuery ?? stored() ?? fallback;
  document.documentElement.dataset.theme = theme;
  syncThemeColor(theme);
}
