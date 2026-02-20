// Node types — universal, works for any domain (legal, design, research, dev, etc.)
export type NodeType =
    | 'background'      // essential context about who/what/why
    | 'decision'        // a choice made, with reasoning
    | 'constraint'      // a hard limit or requirement
    | 'goal'            // what is being achieved
    | 'assumption'      // believed true, not yet verified
    | 'open_question'   // unresolved issue still in flight
    | 'artifact';       // canonical content, document, or reference

// Edge types
export type EdgeType = 'caused_by' | 'constrains' | 'supersedes' | 'depends_on' | 'contradicts';

export interface ContextNode {
    id: string;              // uuid
    contextId: string;       // Foreign key to Context
    thread?: string;         // optional thread within a context
    type: NodeType;
    content: string;
    key?: string;            // optional named key for direct lookup
    tags?: string[];
    source?: string;         // which tool created this
    createdAt: number;       // unix ms
    checkpointId?: string;   // which checkpoint this belongs to
}

export interface ContextEdge {
    id: string;
    fromId: string;
    toId: string;
    relation: EdgeType;
    createdAt: number;
}

export interface Checkpoint {
    id: string;
    contextId: string;
    name: string;
    nodeIds: string[];        // snapshot of which nodes existed
    createdAt: number;
}

// A context is universal — could be a legal case, design brief, research project, codebase, etc.
// This allows non-devs to group nodes logically without needing directories.
export interface Context {
    id: string;               // uuid
    name: string;             // Human readable name (e.g. "Acme Corp Legal Case")
    paths: string[];          // mapped local paths (optional — many contexts are not tied to a directory)
    createdAt: number;
}
