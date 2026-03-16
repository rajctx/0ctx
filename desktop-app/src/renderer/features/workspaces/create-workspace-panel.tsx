import { useState } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { compactPath } from '../../lib/format';
import { desktopBridge } from '../../lib/bridge';
import { useCreateWorkspace } from '../runtime/queries';

interface CreateWorkspacePanelProps {
  onCreated?: () => void;
}

export function CreateWorkspacePanel({ onCreated }: CreateWorkspacePanelProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const createWorkspace = useCreateWorkspace();

  const pickFolder = async () => {
    const folder = await desktopBridge.dialog.pickWorkspaceFolder();
    if (folder) {
      setPath(folder);
      if (!name) {
        const segments = folder.split(/[\\/]/).filter(Boolean);
        setName(segments[segments.length - 1] || 'workspace');
      }
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !path.trim()) {
      return;
    }
    await createWorkspace.mutateAsync({
      name: name.trim(),
      path: path.trim()
    });
    setName('');
    setPath('');
    onCreated?.();
  };

  return (
    <form onSubmit={onSubmit} className="panel-surface flex flex-col gap-5">
      <div>
        <p className="eyebrow">Create workspace</p>
        <h2 className="section-title">New repo binding</h2>
        <p className="section-copy">Name the workspace, choose a repository folder, and create the context.</p>
      </div>

      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="release-hardening" />
      </label>

      <label className="field">
        <span>Repository folder</span>
        <div className="flex gap-3">
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="Choose a local repo" />
          <button type="button" className="button-secondary shrink-0" onClick={pickFolder}>
            <FolderOpen size={16} />
            Choose
          </button>
        </div>
      </label>

      <div className="metric-tile">
        {compactPath(path) || 'Choose a repository path to enable context capture.'}
      </div>

      <button className="button-primary" type="submit" disabled={createWorkspace.isPending}>
        <Plus size={16} />
        {createWorkspace.isPending ? 'Creating workspace...' : 'Create workspace'}
      </button>
    </form>
  );
}
