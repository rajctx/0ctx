(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const {
    state,
    setStatus,
    daemon,
    loadDataPolicy,
    renderAll,
    methodSupported
  } = app;

  function confirmFullSyncOptIn() {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return true;
    }
    return window.confirm(
      'Full sync is an explicit workspace override.\n\n'
      + 'This workspace will send richer metadata to the cloud.\n'
      + 'Local raw payloads still stay on this machine.\n\n'
      + 'Use this only when the workspace should opt into fuller remote sync.'
    );
  }

  function parsePositiveIntInput(id, label) {
    const input = document.getElementById(id);
    const raw = String(input?.value || '').trim();
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(`${label} must be a whole number greater than 0.`);
    }
    return value;
  }

  function readCustomDataPolicyForm() {
    const syncPolicy = String(document.getElementById('dataPolicySyncPolicy')?.value || 'metadata_only').trim().toLowerCase();
    const debugArtifactsEnabled = document.getElementById('dataPolicyDebugArtifacts')?.checked === true;
    return {
      syncPolicy,
      captureRetentionDays: parsePositiveIntInput('dataPolicyCaptureRetention', 'Capture retention'),
      debugRetentionDays: parsePositiveIntInput('dataPolicyDebugRetention', 'Debug retention'),
      debugArtifactsEnabled
    };
  }

  async function applyCustomDataPolicy(event) {
    event?.preventDefault?.();
    if (!methodSupported('setDataPolicy')) {
      setStatus('Update the local runtime before changing sync or retention settings from the desktop.');
      return;
    }

    let nextPolicy;
    try {
      nextPolicy = readCustomDataPolicyForm();
    } catch (error) {
      setStatus(String(error?.message || error));
      return;
    }

    if (nextPolicy.syncPolicy === 'full_sync' && !state.activeContextId) {
      setStatus('Full sync is available only after a workspace is active.');
      return;
    }
    if (nextPolicy.syncPolicy === 'full_sync' && !confirmFullSyncOptIn()) {
      setStatus('Full sync change canceled.');
      return;
    }

    try {
      const result = await daemon('setDataPolicy', {
        ...(state.activeContextId ? { contextId: state.activeContextId } : {}),
        preset: 'custom',
        ...nextPolicy
      });
      state.dataPolicy = result;
      await loadDataPolicy();
      renderAll();
      const preset = String(result?.preset || 'custom').trim().toLowerCase();
      setStatus(preset === 'custom' ? 'Applied custom data policy.' : `Applied ${preset} data policy.`);
    } catch (error) {
      setStatus(`Update data policy failed: ${String(error)}`);
    }
  }

  Object.assign(app, { applyCustomDataPolicy });
})();
