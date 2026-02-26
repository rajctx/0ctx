'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(resolvedTheme: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Hardcoded to dark mode to match the global design system
  const theme: ThemeMode = 'dark';
  const resolvedTheme: 'light' | 'dark' = 'dark';

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme: () => { }, // No-op as theme is locked
      cycleTheme: () => { } // No-op
    }),
    []
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

