const {
  describeWorkspaceSyncDisplay,
  describeDesktopPolicyHint
} = require('../src/app/policy-view.js');

describe('desktop policy presentation', () => {
  const formatSyncPolicyLabel = (policy) => {
    const value = String(policy || '').trim().toLowerCase();
    if (value === 'full_sync') return 'Full Sync (opt-in)';
    if (value === 'local_only') return 'Local Only';
    return 'Metadata Only (default)';
  };

  it('shows unresolved workspace sync honestly before a workspace is active', () => {
    const workspaceSync = describeWorkspaceSyncDisplay({
      policy: {
        workspaceResolved: false,
        syncPolicy: 'metadata_only'
      },
      hasActiveWorkspace: false,
      formatSyncPolicyLabel
    });

    expect(workspaceSync).toEqual({
      workspaceResolved: false,
      detail: 'No active workspace yet',
      hint: 'Metadata Only (default) becomes the workspace default after a workspace is active.'
    });
  });

  it('keeps the unresolved hint in the desktop policy guidance', () => {
    const hint = describeDesktopPolicyHint({
      supportsMutation: true,
      policy: {
        workspaceResolved: false,
        syncPolicy: 'metadata_only',
        preset: 'lean'
      },
      workspaceResolved: false,
      actionHint: '',
      workspaceHint: 'Metadata Only (default) becomes the workspace default after a workspace is active.'
    });

    expect(hint).toContain('No active workspace yet.');
    expect(hint).toContain('Full sync is available only after a workspace is active.');
    expect(hint).toContain('Metadata Only (default) becomes the workspace default after a workspace is active.');
  });
});
