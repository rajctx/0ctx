const METHOD_TO_EVENT_TYPE: Record<string, string> = {
    createContext: 'ContextCreated',
    deleteContext: 'ContextDeleted',
    switchContext: 'ContextSwitched',
    addNode: 'NodeAdded',
    updateNode: 'NodeUpdated',
    deleteNode: 'NodeDeleted',
    addEdge: 'EdgeAdded',
    saveCheckpoint: 'CheckpointSaved',
    rewind: 'CheckpointRewound',
    createBackup: 'BackupCreated',
    restoreBackup: 'BackupRestored'
};

export function getMutationEventType(method: string): string {
    return METHOD_TO_EVENT_TYPE[method] ?? 'Mutation';
}
