import { useEffect, useState } from 'react';

const storageKey = 'resilience-theme';
const modes = ['light', 'dark', 'system'];

function readMode() {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return modes.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyMode(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

// Applique le thème enregistré avant le premier rendu pour éviter tout flash.
applyMode(readMode());

export function useTheme() {
  const [mode, setMode] = useState(readMode);

  useEffect(() => {
    applyMode(mode);
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch {
      // Le choix reste actif pour la session même si le stockage est bloqué.
    }
  }, [mode]);

  return [mode, setMode];
}
