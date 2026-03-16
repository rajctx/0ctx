export const desktopChannels = {
  app: {
    status: 'desktop:app/status',
    posture: 'desktop:app/posture',
    version: 'desktop:app/version'
  },
  daemon: {
    call: 'desktop:daemon/call'
  },
  connector: {
    restart: 'desktop:connector/restart',
    status: 'desktop:connector/status'
  },
  dialog: {
    pickWorkspaceFolder: 'desktop:dialog/pick-workspace-folder'
  },
  shell: {
    openPath: 'desktop:shell/open-path'
  },
  updates: {
    check: 'desktop:updates/check'
  },
  events: {
    start: 'desktop:events/start',
    stop: 'desktop:events/stop',
    push: 'desktop:events/push'
  },
  tray: {
    show: 'desktop:tray/show'
  },
  preferences: {
    get: 'desktop:preferences/get',
    update: 'desktop:preferences/update'
  }
} as const;
