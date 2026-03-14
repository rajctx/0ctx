import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { WorkspaceContext } from '../../../shared/types/domain';
import { useCreateWorkspace, useDesktopStatus, useRepoReadiness, useSessions, useWorkstreams } from '../../features/runtime/queries';
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
  onSelect
}: {
  context: WorkspaceContext;
  active: boolean;
  onSelect: (contextId: string) => void;
}) {
  const workstreams = useWorkstreams(context.id);
  const sessions = useSessions(context.id, null, null, `workspace-row:${context.id}`);
  const readiness = useRepoReadiness(context.id, context.paths?.[0] ?? null);

  const workstreamCount = workstreams.data?.length ?? 0;
  const sessionCount = sessions.data?.length ?? 0;
  const isBound = Boolean(context.paths?.[0]);
  const preset = formatPresetLabel(readiness.data?.dataPolicyPreset);
  const status = active ? 'Selected' : isBound ? `${workstreamCount} ws · ${sessionCount} sess` : 'Unbound';
  const meta = active
    ? `Repo bound · ${preset} · ${workstreamCount} workstreams · ${sessionCount} sessions`
    : isBound
      ? `Repo bound${preset ? ` · ${preset}` : ''}`
      : 'No repository folder bound yet. Needs repository binding.';

  return (
    <button type="button" className="ws-row" onClick={() => onSelect(context.id)}>
      <div className="ws-row-header">
        <span className="brk">{active ? '[●]' : '[ ]'}</span>
        <span className={active ? 'ws-name' : 'ws-name dim'}>{context.name}</span>
        <span className={active ? 'ws-status bright' : 'ws-status'}>{status}</span>
      </div>
      <div className={active ? 'ws-meta' : 'ws-meta dim'}>{meta}</div>
      {context.paths?.[0] ? <div className="ws-path">{displayPath(context.paths[0])}</div> : null}
    </button>
  );
}

export function OverviewScreen() {
  const { data: status } = useDesktopStatus();
  const { activeContextId, setActiveContextId, search } = useShellStore();
  const createWorkspace = useCreateWorkspace();
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const contexts = status?.contexts ?? [];
  const activeContext = contexts.find((context) => context.id === activeContextId) ?? contexts[0] ?? null;

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
              onSelect={setActiveContextId}
            />
          ))}
        </div>
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
