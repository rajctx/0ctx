(function (factory) {
  const api = factory();
  if (typeof window !== 'undefined') {
    window.OctxDesktop = window.OctxDesktop || {};
    Object.assign(window.OctxDesktop, api);
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {
  function describeWorkspaceSyncDisplay(options) {
    const policy = options.policy || {};
    const workspaceResolved = policy.workspaceResolved === true && options.hasActiveWorkspace === true;
    const defaultLabel = options.formatSyncPolicyLabel(policy.syncPolicy || 'metadata_only');

    if (workspaceResolved) {
      return {
        workspaceResolved: true,
        detail: defaultLabel,
        hint: ''
      };
    }

    return {
      workspaceResolved: false,
      detail: 'No active workspace yet',
      hint: `${defaultLabel} becomes the workspace default after a workspace is active.`
    };
  }

  function describeDesktopPolicyHint(options) {
    const policy = options.policy || {};
    const preset = String(policy.preset || 'lean').trim().toLowerCase();
    const syncPolicy = String(policy.syncPolicy || 'metadata_only').trim().toLowerCase();

    if (!options.supportsMutation) {
      return 'Update the local runtime before changing sync or machine capture defaults from the desktop.';
    }
    if (preset === 'custom') {
      return 'This workspace and this machine are using a custom combination. Choose Lean, Review, or Debug to return machine defaults to a standard product path. Use full sync only as an explicit workspace override.';
    }
    if (!options.workspaceResolved) {
      return `No active workspace yet. Lean, Review, and Debug change machine capture defaults immediately. Full sync is available only after a workspace is active. ${options.workspaceHint}`.trim();
    }
    if (preset === 'shared' || syncPolicy === 'full_sync') {
      return 'This workspace is explicitly opted into full sync. Machine retention remains local, and utility debug trails stay off unless you explicitly enable them.';
    }
    if (options.actionHint) {
      return `Lean is the normal default. Workspace sync stays metadata-only unless you opt this workspace into full sync. Utility debug trails stay off unless you explicitly enable them. ${options.actionHint}`;
    }
    return 'Lean is the normal default. Review and Debug only change machine-local retention. Full sync is a separate workspace override.';
  }

  return {
    describeWorkspaceSyncDisplay,
    describeDesktopPolicyHint
  };
});
