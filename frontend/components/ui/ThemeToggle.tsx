"use client";

import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.css';

type Pref = 'light' | 'dark' | 'system';

const KEY = 'rocketship-theme';

function systemTheme(): 'light' | 'dark' {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function apply(pref: Pref) {
  const resolved = pref === 'system' ? systemTheme() : pref;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
}

/**
 * Three states, not two. The previous version stored only light/dark and
 * defaulted to light, so a dark-OS user had to toggle on every device and the
 * "system" case did not exist. The blocking script in layout.tsx applies the
 * same rule before first paint; this component only handles changes.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [pref, setPref] = useState<Pref>('system');

  useEffect(() => {
    setMounted(true);
    const saved = window.localStorage.getItem(KEY) as Pref | null;
    setPref(saved === 'light' || saved === 'dark' ? saved : 'system');
  }, []);

  // Track the OS while the preference is 'system'.
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const cycle = () => {
    const order: Pref[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(pref) + 1) % order.length];
    setPref(next);
    if (next === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
    apply(next);
  };

  if (!mounted) {
    return <div className={styles.placeholder} aria-hidden="true" />;
  }

  const label = pref === 'system' ? 'Auto' : pref === 'light' ? 'Light' : 'Dark';

  return (
    <button
      className={styles.toggle}
      onClick={cycle}
      aria-label={`Theme: ${label}. Click to change.`}
      title={`Theme: ${label}`}
    >
      {label}
    </button>
  );
}
