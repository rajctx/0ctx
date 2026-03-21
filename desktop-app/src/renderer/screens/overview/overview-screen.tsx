import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { WorkspaceContext } from '../../../shared/types/domain';
import { useCreateWorkspace, useDeleteWorkspace, useDesktopStatus, useRepoReadiness, useSessions, useWorkstreams } from '../../features/runtime/queries';
import { useShellStore } from '../../lib/store';

function displayPath(value?: string | null) {
  if (!value) {
    return '';
  }
  return value.replace(/\\/g, '/');
}

function formatPresetLabel(value?: string | null) {
  switch (String(value || '').trim().toLowerCase()) {
    case 'lean':
      return 'lean';
    case 'shared':
      return 'shared';
    case 'review':
      return 'review';
    default:
      return 'lean';
  }
}

function WorkspaceRow({
  context,
  active,
  onSelect,
  onDelete,
  deletePending,
  activeStats
}: {
  context: WorkspaceContext;
  active: boolean;
  onSelect: (contextId: string) => void;
  onDelete: (context: WorkspaceContext) => void;
  deletePending: boolean;
  activeStats?: {
    workstreamCount: number;
    sessionCount: number;
    preset: string;
  } | null;
}) {
  const isBound = Boolean(context.paths?.[0]);
  const workstreamCount = active ? (activeStats?.workstreamCount ?? 0) : null;
  const sessionCount = active ? (activeStats?.sessionCount ?? 0) : null;
  const preset = active ? (activeStats?.preset ?? 'lean') : null;
  const status = active ? 'Selected' : isBound ? 'Repo bound' : 'Unbound';
  const meta = active
    ? `Repo bound · ${preset} · ${workstreamCount ?? 0} workstreams · ${sessionCount ?? 0} sessions`
    : isBound
      ? 'Select workspace to inspect workstream and session detail.'
      : 'No repository folder bound yet. Needs repository binding.';

  return (
    <div className="ws-row">
      <button type="button" className="ws-row-main" onClick={() => onSelect(context.id)}>
        <div className="ws-row-header">
          <span className="brk">{active ? '[●]' : '[ ]'}</span>
          <span className={active ? 'ws-name' : 'ws-name dim'}>{context.name}</span>
          <span className={active ? 'ws-status bright' : 'ws-status'}>{status}</span>
        </div>
        <div className={active ? 'ws-meta' : 'ws-meta dim'}>{meta}</div>
        {context.paths?.[0] ? <div className="ws-path">{displayPath(context.paths[0])}</div> : null}
      </button>
      <button
        type="button"
        className="ws-row-delete"
        disabled={deletePending}
        aria-label={`Delete workspace ${context.name}`}
        title={`Delete workspace ${context.name}`}
        onClick={() => onDelete(context)}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function OverviewScreen() {
  const { data: status } = useDesktopStatus();
  const {
    activeContextId,
    search,
    setActiveContextId,
    setActiveWorkstreamKey,
    setActiveSessionId,
    setActiveCheckpointId,
    setActiveInsightId
  } = useShellStore();
  const createWorkspace = useCreateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const contexts = status?.contexts ?? [];
  const activeContext = contexts.find((context) => context.id === activeContextId) ?? contexts[0] ?? null;
  const activeWorkstreams = useWorkstreams(activeContext?.id ?? null);
  const activeSessions = useSessions(activeContext?.id ?? null, null, null, `overview-active:${activeContext?.id ?? 'none'}`);
  const activeReadiness = useRepoReadiness(activeContext?.id ?? null, activeContext?.paths?.[0] ?? null);

  const filteredContexts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return contexts;
    }
    return contexts.filter((context) => `${context.name} ${context.paths.join(' ')}`.toLowerCase().includes(query));
  }, [search, contexts]);

  useEffect(() => {
    if (!activeContextId && contexts[0]?.id) {
      setActiveContextId(contexts[0].id);
    }
  }, [activeContextId, contexts, setActiveContextId]);

  const handleWorkspaceSelect = (contextId: string) => {
    setActiveContextId(contextId);
    setActiveWorkstreamKey(null);
    setActiveSessionId(null);
    setActiveCheckpointId(null);
    setActiveInsightId(null);
  };

  const activeStats = activeContext
    ? {
      workstreamCount: activeWorkstreams.data?.length ?? 0,
      sessionCount: activeSessions.data?.length ?? 0,
      preset: formatPresetLabel(activeReadiness.data?.dataPolicyPreset)
    }
    : null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !repoPath.trim()) {
      return;
    }

    await createWorkspace.mutateAsync({
      name: name.trim(),
      path: repoPath.trim()
    });

    setName('');
    setRepoPath('');
  };

  const onDeleteWorkspace = async (context: WorkspaceContext) => {
    if (!context) {
      return;
    }

    const accepted = window.confirm(
      `Delete workspace "${context.name}" and all of its local 0ctx history?\n\nThis does not modify repository files.`
    );
    if (!accepted) {
      return;
    }

    await deleteWorkspace.mutateAsync({ contextId: context.id });
  };

  const deleteError = deleteWorkspace.error instanceof Error ? deleteWorkspace.error.message : null;

  return (
    <>
      <div>
        <div className="page-eyebrow">Workspace Library</div>
        <div className="page-title">Projects and repository bindings</div>
        <div className="page-desc">
          {`${contexts.length} workspaces on this machine. ${activeContext?.name ?? 'No workspace'} is active. Create a workspace once, bind its repository folder, and route future capture automatically.`}
        </div>
      </div>

      <div>
        <div className="section-label">Workspaces &mdash; {contexts.length} total</div>
        <div className="ws-list">
          {filteredContexts.map((context) => (
            <WorkspaceRow
              key={context.id}
              context={context}
              active={context.id === activeContext?.id}
              onSelect={handleWorkspaceSelect}
              onDelete={(targetContext) => {
                void onDeleteWorkspace(targetContext);
              }}
              deletePending={deleteWorkspace.isPending}
              activeStats={context.id === activeContext?.id ? activeStats : null}
            />
          ))}
        </div>
        {deleteError ? (
          <div className="form-note">
            {`Delete failed: ${deleteError}`}
          </div>
        ) : null}
      </div>

      <form className="form-section" onSubmit={onSubmit}>
        <div className="section-label">Workspace Editor</div>
        <div className="form-subtitle">Create a new workspace</div>

        <label className="form-field">
          <span className="form-key">NAME:</span>
          <input
            id="workspace-name-input"
            className="form-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="workspace name"
          />
        </label>

        <label className="form-field">
          <span className="form-key">REPO:</span>
          <input
            className="form-input"
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="repository folder path"
          />
        </label>

        <button type="submit" className="form-action" disabled={createWorkspace.isPending}>
          <span>[+]</span>&nbsp;SAVE WORKSPACE
        </button>
        <div className="form-note">
          Workspaces are lightweight bindings to local folders.
          They do not modify your files.
        </div>
      </form>
    </>
  );
}
