import type {
  ChatMessage,
  ChatSessionDetail,
  CheckpointDetail,
  ConnectorStatus,
  DaemonStatus,
  DataPolicy,
  DesktopEventMessage,
  DesktopPosture,
  DesktopPreferences,
  HookHealth,
  InsightSummary,
  RepoReadiness,
  UpdateStatus,
  WorkstreamSummary,
  WorkspaceContext,
  ChatSessionSummary,
  CheckpointSummary
} from '../types/domain';

export interface DesktopAppApi {
  getStatus(): Promise<DaemonStatus>;
  getPosture(): Promise<DesktopPosture>;
  getVersion(): Promise<string>;
}

export interface DesktopDaemonApi {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export interface DesktopConnectorApi {
  restart(): Promise<ConnectorStatus>;
  getStatus(): Promise<ConnectorStatus>;
}

export interface DesktopDialogApi {
  pickWorkspaceFolder(): Promise<string | null>;
}

export interface DesktopShellApi {
  openPath(path: string): Promise<{ ok: boolean; message: string }>;
}

export interface DesktopUpdatesApi {
  check(): Promise<UpdateStatus>;
}

export interface DesktopTrayApi {
  show(): Promise<void>;
}

export interface DesktopPreferencesApi {
  get(): Promise<DesktopPreferences>;
  update(patch: Partial<DesktopPreferences>): Promise<DesktopPreferences>;
}

export interface DesktopEventsApi {
  start(contextId?: string | null): Promise<{ subscriptionId: string | null }>;
  stop(): Promise<void>;
  subscribe(listener: (event: DesktopEventMessage) => void): () => void;
}

export interface DesktopApi {
  app: DesktopAppApi;
  daemon: DesktopDaemonApi;
  connector: DesktopConnectorApi;
  dialog: DesktopDialogApi;
  shell: DesktopShellApi;
  updates: DesktopUpdatesApi;
  events: DesktopEventsApi;
  tray: DesktopTrayApi;
  preferences: DesktopPreferencesApi;
}

export interface OverviewBundle {
  contexts: WorkspaceContext[];
  workstreams: WorkstreamSummary[];
  sessions: ChatSessionSummary[];
  checkpoints: CheckpointSummary[];
  insights: InsightSummary[];
  dataPolicy: DataPolicy | null;
  repoReadiness: RepoReadiness | null;
  hookHealth: HookHealth | null;
}

export interface SessionBundle {
  detail: ChatSessionDetail | null;
  messages: ChatMessage[];
}

export interface CheckpointBundle {
  detail: CheckpointDetail | null;
}
