import { create } from 'zustand';
import type { ThemeMode } from '../../shared/types/domain';

type DrawerKind = 'checkpoint' | 'insight' | null;

interface ShellStore {
  activeContextId: string | null;
  activeWorkstreamKey: string | null;
  activeSessionId: string | null;
  activeCheckpointId: string | null;
  activeInsightId: string | null;
  search: string;
  drawer: DrawerKind;
  theme: ThemeMode;
  setActiveContextId: (value: string | null) => void;
  setActiveWorkstreamKey: (value: string | null) => void;
  setActiveSessionId: (value: string | null) => void;
  setActiveCheckpointId: (value: string | null) => void;
  setActiveInsightId: (value: string | null) => void;
  setSearch: (value: string) => void;
  openDrawer: (value: DrawerKind) => void;
  closeDrawer: () => void;
  setTheme: (value: ThemeMode) => void;
}

export const useShellStore = create<ShellStore>((set) => ({
  activeContextId: null,
  activeWorkstreamKey: null,
  activeSessionId: null,
  activeCheckpointId: null,
  activeInsightId: null,
  search: '',
  drawer: null,
  theme: 'midnight',
  setActiveContextId: (value) => set({ activeContextId: value }),
  setActiveWorkstreamKey: (value) => set({ activeWorkstreamKey: value }),
  setActiveSessionId: (value) => set({ activeSessionId: value }),
  setActiveCheckpointId: (value) => set({ activeCheckpointId: value }),
  setActiveInsightId: (value) => set({ activeInsightId: value }),
  setSearch: (value) => set({ search: value }),
  openDrawer: (value) => set({ drawer: value }),
  closeDrawer: () => set({ drawer: null }),
  setTheme: (value) => set({ theme: value })
}));
