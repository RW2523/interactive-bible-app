import { useEffect, useState } from 'react';

function readTheme() {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** The app theme ('light' | 'dark'), following changes to <html data-theme> however they are made. */
export function useDocumentTheme() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    setTheme(readTheme());
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** Read Explore colour tokens (CSS custom properties) from an element, e.g. for canvas drawing. */
export function readCssVars(el, names) {
  const out = {};
  if (!el) return out;
  const style = getComputedStyle(el);
  for (const name of names) out[name] = style.getPropertyValue(name).trim();
  return out;
}
