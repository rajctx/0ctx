# 0ctx — AI Agent Setup Guide

You are setting up the **0ctx** project: a persistent, local-first, graph-based context engine that eliminates context loss across AI tool switches — for everyone who uses AI, not just developers. One monorepo for the open-source local product, one separate repo for the cloud backend.

**The core idea:** AI tools are stateless. People's work is not. 0ctx is the persistent layer in between — it holds the living reasoning graph of whatever someone is working on, and makes it instantly available to every AI tool they use.

---

## What You Are Building

- A persistent local **daemon** that holds a knowledge graph in SQLite
- An **MCP server** that any MCP-compatible AI tool connects to (Claude Desktop, Cursor, Claude Code, and others)
- A **CLI** for terminal interaction (technical users / developers)
- A local **web UI** for visualising and editing the graph (primary surface for non-technical users)
- A **sync package** for optional cloud sync (SaaS layer, wired up later)

---

## Repo Structure to Create

```
0ctx/                          ← monorepo root
├── package.json               ← workspace root
├── tsconfig.base.json         ← shared TS config
├── .env.example
├── README.md
└── packages/
    ├── core/                  ← graph engine, SQLite, pure logic
    ├── daemon/                ← persistent process, IPC socket
    ├── mcp/                   ← MCP server, tool definitions
    ├── cli/                   ← terminal interface
    ├── ui/                    ← local web dashboard
    └── sync/                  ← cloud sync, encryption (stub for now)
```

---

## Step 1 — Monorepo Root

Init the workspace:

```bash
mkdir 0ctx && cd 0ctx
git init
npm init -y
```

Set `package.json` to:

```json
{
  "name": "0ctx",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "tsc -b packages/*/tsconfig.json",
    "dev": "npm run dev --workspace=packages/daemon",
    "lint": "eslint packages/*/src/**/*.ts"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "eslint": "^9.0.0"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist"
  }
}
```

---

## Step 2 — `packages/core`

This is the graph engine. No MCP, no HTTP, no UI. Pure logic only.

```bash
mkdir -p packages/core/src
cd packages/core && npm init -y
```

**Dependencies:**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

**`packages/core/src/schema.ts`** — define the graph schema:

```typescript
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
  context: string;         // context key — universal term (a case, brief, project, research thread)
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
  context: string;
  name: string;
  nodeIds: string[];        // snapshot of which nodes existed
  createdAt: number;
}

// A context is universal — could be a legal case, design brief, research project, codebase, etc.
export interface Context {
  key: string;
  name: string;
  paths: string[];          // mapped local paths (optional — many contexts are not tied to a directory)
  createdAt: number;
}
```

**`packages/core/src/db.ts`** — SQLite init and migrations:

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const DB_PATH = path.join(os.homedir(), '.0ctx', '0ctx.db');

export function openDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contexts (
      key        TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      paths      TEXT NOT NULL DEFAULT '[]',
      createdAt  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id          TEXT PRIMARY KEY,
      context     TEXT NOT NULL,
      thread      TEXT,
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      key         TEXT,
      tags        TEXT NOT NULL DEFAULT '[]',
      source      TEXT,
      createdAt   INTEGER NOT NULL,
      checkpointId TEXT,
      FOREIGN KEY (context) REFERENCES contexts(key)
    );

    CREATE TABLE IF NOT EXISTS edges (
      id        TEXT PRIMARY KEY,
      fromId    TEXT NOT NULL,
      toId      TEXT NOT NULL,
      relation  TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (fromId) REFERENCES nodes(id),
      FOREIGN KEY (toId)   REFERENCES nodes(id)
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      id        TEXT PRIMARY KEY,
      project   TEXT NOT NULL,
      name      TEXT NOT NULL,
      nodeIds   TEXT NOT NULL DEFAULT '[]',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (context) REFERENCES contexts(key)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts
      USING fts5(id UNINDEXED, content, tags, tokenize='porter ascii');
  `);
}
```

**`packages/core/src/graph.ts`** — core graph operations:

```typescript
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { ContextNode, ContextEdge, NodeType, EdgeType, Checkpoint } from './schema';

export class Graph {
  constructor(private db: Database.Database) {}

  // ── Nodes ──────────────────────────────────────────────────────
  addNode(params: Omit<ContextNode, 'id' | 'createdAt'>): ContextNode {
    const node: ContextNode = { ...params, id: randomUUID(), createdAt: Date.now() };
    this.db.prepare(`
      INSERT INTO nodes (id, context, thread, type, content, key, tags, source, createdAt)
      VALUES (@id, @context, @thread, @type, @content, @key, @tags, @source, @createdAt)
    `).run({ ...node, tags: JSON.stringify(node.tags ?? []) });

    this.db.prepare(`
      INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
    `).run(node.id, node.content, (node.tags ?? []).join(' '));

    return node;
  }

  getNode(id: string): ContextNode | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
    return row ? { ...row, tags: JSON.parse(row.tags) } : null;
  }

  getByKey(context: string, key: string): ContextNode | null {
    const row = this.db.prepare(
      'SELECT * FROM nodes WHERE context = ? AND key = ? ORDER BY createdAt DESC LIMIT 1'
    ).get(context, key) as any;
    return row ? { ...row, tags: JSON.parse(row.tags) } : null;
  }

  deleteNode(id: string): void {
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM edges WHERE fromId = ? OR toId = ?').run(id, id);
  }

  // ── Edges ──────────────────────────────────────────────────────
  addEdge(fromId: string, toId: string, relation: EdgeType): ContextEdge {
    const edge: ContextEdge = { id: randomUUID(), fromId, toId, relation, createdAt: Date.now() };
    this.db.prepare(`
      INSERT INTO edges (id, fromId, toId, relation, createdAt)
      VALUES (@id, @fromId, @toId, @relation, @createdAt)
    `).run(edge);
    return edge;
  }

  getEdges(nodeId: string): ContextEdge[] {
    return this.db.prepare(
      'SELECT * FROM edges WHERE fromId = ? OR toId = ?'
    ).all(nodeId, nodeId) as ContextEdge[];
  }

  // ── Subgraph traversal ─────────────────────────────────────────
  getSubgraph(rootId: string, depth = 2): { nodes: ContextNode[]; edges: ContextEdge[] } {
    const visited = new Set<string>();
    const nodes: ContextNode[] = [];
    const edges: ContextEdge[] = [];

    const traverse = (id: string, d: number) => {
      if (visited.has(id) || d < 0) return;
      visited.add(id);
      const node = this.getNode(id);
      if (node) nodes.push(node);
      const nodeEdges = this.getEdges(id);
      for (const edge of nodeEdges) {
        edges.push(edge);
        const nextId = edge.fromId === id ? edge.toId : edge.fromId;
        traverse(nextId, d - 1);
      }
    };
    traverse(rootId, depth);
    return { nodes, edges };
  }

  // ── Search ─────────────────────────────────────────────────────
  search(context: string, query: string, limit = 20): ContextNode[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      JOIN nodes_fts f ON n.id = f.id
      WHERE n.context = ? AND nodes_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(project, query, limit) as any[];
    return rows.map(r => ({ ...r, tags: JSON.parse(r.tags) }));
  }

  // ── Checkpoints ────────────────────────────────────────────────
  saveCheckpoint(context: string, name: string): Checkpoint {
    const nodeIds = (this.db.prepare(
      'SELECT id FROM nodes WHERE context = ?'
    ).all(context) as any[]).map(r => r.id);

    const cp: Checkpoint = { id: randomUUID(), context, name, nodeIds, createdAt: Date.now() };
    this.db.prepare(`
      INSERT INTO checkpoints (id, project, name, nodeIds, createdAt)
      VALUES (@id, @project, @name, @nodeIds, @createdAt)
    `).run({ ...cp, nodeIds: JSON.stringify(cp.nodeIds) });
    return cp;
  }

  rewind(checkpointId: string): void {
    const cp = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
    if (!cp) throw new Error(`Checkpoint ${checkpointId} not found`);
    const allowed = new Set<string>(JSON.parse(cp.nodeIds));
    const current = (this.db.prepare(
      'SELECT id FROM nodes WHERE context = ?'
    ).all(cp.context) as any[]).map(r => r.id);
    for (const id of current) {
      if (!allowed.has(id)) this.deleteNode(id);
    }
  }

  listCheckpoints(context: string): Checkpoint[] {
    return (this.db.prepare(
      'SELECT * FROM checkpoints WHERE context = ? ORDER BY createdAt DESC'
    ).all(context) as any[]).map(r => ({ ...r, nodeIds: JSON.parse(r.nodeIds) }));
  }
}
```

**`packages/core/src/index.ts`:**

```typescript
export { openDb } from './db';
export { Graph } from './graph';
export type { ContextNode, ContextEdge, NodeType, EdgeType, Checkpoint, Project } from './schema';
```

---

## Step 3 — `packages/daemon`

The persistent process. Holds the db connection, manages project resolution, exposes a Unix socket for IPC.

```bash
mkdir -p packages/daemon/src
cd packages/daemon && npm init -y
npm install @0ctx/core uuid
npm install -D @types/uuid
```

**`packages/daemon/src/resolver.ts`** — project auto-detection:

```typescript
import fs from 'fs';
import path from 'path';

// Resolves the active context key from the working directory.
// For technical users: package.json name or directory name.
// For non-technical users: context is set explicitly via UI or CLI.
export function resolveContext(cwd: string): string {
  // Walk up to find package.json for project name
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const { name } = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (name) return name;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  // Fallback: use directory name
  return path.basename(cwd);
}
```

**`packages/daemon/src/server.ts`** — IPC socket server:

```typescript
import net from 'net';
import path from 'path';
import os from 'os';
import { openDb, Graph } from '@0ctx/core';

const SOCKET_PATH = path.join(os.homedir(), '.0ctx', '0ctx.sock');

export function startDaemon() {
  const db = openDb();
  const graph = new Graph(db);

  const server = net.createServer(socket => {
    socket.on('data', data => {
      try {
        const req = JSON.parse(data.toString());
        const result = handleRequest(graph, req);
        socket.write(JSON.stringify({ ok: true, result }) + '\n');
      } catch (err: any) {
        socket.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
      }
    });
  });

  server.listen(SOCKET_PATH, () => {
    console.log(`0ctx daemon running at ${SOCKET_PATH}`);
  });

  process.on('SIGINT', () => { server.close(); process.exit(); });
  process.on('SIGTERM', () => { server.close(); process.exit(); });
}

function handleRequest(graph: Graph, req: any): any {
  switch (req.method) {
    case 'addNode':       return graph.addNode(req.params);
    case 'getNode':       return graph.getNode(req.params.id);
    case 'getByKey':      return graph.getByKey(req.params.context, req.params.key);
    case 'deleteNode':    return graph.deleteNode(req.params.id);
    case 'addEdge':       return graph.addEdge(req.params.fromId, req.params.toId, req.params.relation);
    case 'getSubgraph':   return graph.getSubgraph(req.params.rootId, req.params.depth);
    case 'search':        return graph.search(req.params.context, req.params.query, req.params.limit);
    case 'saveCheckpoint':return graph.saveCheckpoint(req.params.context, req.params.name);
    case 'rewind':        return graph.rewind(req.params.checkpointId);
    case 'listCheckpoints': return graph.listCheckpoints(req.params.context);
    default: throw new Error(`Unknown method: ${req.method}`);
  }
}
```

**`packages/daemon/src/index.ts`:**

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { startDaemon } from './server';

// Ensure ~/.0ctx dir exists
const DIR = path.join(os.homedir(), '.0ctx');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

startDaemon();
```

---

## Step 4 — `packages/mcp`

MCP server. Connects to the daemon socket and exposes tools to AI tools.

```bash
mkdir -p packages/mcp/src
cd packages/mcp && npm init -y
npm install @modelcontextprotocol/sdk
```

**`packages/mcp/src/tools.ts`** — tool definitions:

```typescript
export const tools = [
  {
    name: 'ctx_set',
    description: 'Write a context node to the graph. Works for any domain — legal, design, research, development, or anything else.',
    inputSchema: {
      type: 'object',
      properties: {
        type:    { type: 'string', enum: ['background','decision','constraint','goal','assumption','open_question','artifact'] },
        content: { type: 'string', description: 'The content of the context entry' },
        key:     { type: 'string', description: 'Optional named key for direct lookup (e.g. auth-strategy)' },
        tags:    { type: 'array', items: { type: 'string' } },
        relatesTo: { type: 'string', description: 'Optional node ID this relates to' },
        relation:  { type: 'string', enum: ['caused_by','constrains','supersedes','depends_on','contradicts'] },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'ctx_get',
    description: 'Retrieve a context node by named key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
      },
      required: ['key'],
    },
  },
  {
    name: 'ctx_query',
    description: 'Traverse the graph from a node. Returns the subgraph up to a given depth.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        depth:  { type: 'number', default: 2 },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'ctx_search',
    description: 'Full-text search across all context nodes in the current project.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'ctx_checkpoint',
    description: 'Save a named checkpoint of the current graph state.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'ctx_rewind',
    description: 'Restore the graph to a previously saved checkpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        checkpointId: { type: 'string' },
      },
      required: ['checkpointId'],
    },
  },
  {
    name: 'ctx_handoff',
    description: 'Export the current project context as a portable handoff packet (JSON).',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'boolean', default: true, description: 'Include a natural language summary' },
      },
    },
  },
];
```

**`packages/mcp/src/index.ts`** — MCP server:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools } from './tools';
import { sendToDaemon } from './client';
import { resolveContext } from '@0ctx/daemon/resolver';

const context = resolveContext(process.cwd());

const server = new Server(
  { name: '0ctx', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler('tools/list', async () => ({ tools }));

server.setRequestHandler('tools/call', async (req: any) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case 'ctx_set': {
      const node = await sendToDaemon('addNode', { ...args, context, source: '0ctx-mcp' });
      if (args.relatesTo && args.relation) {
        await sendToDaemon('addEdge', { fromId: node.id, toId: args.relatesTo, relation: args.relation });
      }
      return { content: [{ type: 'text', text: `Saved: ${node.id}` }] };
    }
    case 'ctx_get': {
      const node = await sendToDaemon('getByKey', { context, key: args.key });
      return { content: [{ type: 'text', text: node ? JSON.stringify(node, null, 2) : 'Not found' }] };
    }
    case 'ctx_query': {
      const subgraph = await sendToDaemon('getSubgraph', { rootId: args.nodeId, depth: args.depth ?? 2 });
      return { content: [{ type: 'text', text: JSON.stringify(subgraph, null, 2) }] };
    }
    case 'ctx_search': {
      const results = await sendToDaemon('search', { context, query: args.query, limit: args.limit ?? 10 });
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }
    case 'ctx_checkpoint': {
      const cp = await sendToDaemon('saveCheckpoint', { context, name: args.name });
      return { content: [{ type: 'text', text: `Checkpoint saved: ${cp.id}` }] };
    }
    case 'ctx_rewind': {
      await sendToDaemon('rewind', { checkpointId: args.checkpointId });
      return { content: [{ type: 'text', text: 'Rewound to checkpoint.' }] };
    }
    case 'ctx_handoff': {
      const subgraph = await sendToDaemon('getSubgraph', { rootId: context, depth: 99 });
      const checkpoints = await sendToDaemon('listCheckpoints', { context });
      return { content: [{ type: 'text', text: JSON.stringify({ project, subgraph, checkpoints }, null, 2) }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
server.connect(transport);
```

**`packages/mcp/src/client.ts`** — socket client to talk to daemon:

```typescript
import net from 'net';
import path from 'path';
import os from 'os';

const SOCKET_PATH = path.join(os.homedir(), '.0ctx', '0ctx.sock');

export function sendToDaemon(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH);
    socket.write(JSON.stringify({ method, params }));
    socket.on('data', data => {
      const res = JSON.parse(data.toString());
      socket.destroy();
      if (res.ok) resolve(res.result);
      else reject(new Error(res.error));
    });
    socket.on('error', reject);
  });
}
```

---

## Step 5 — `packages/cli`

```bash
mkdir -p packages/cli/src
cd packages/cli && npm init -y
npm install commander chalk
```

**`packages/cli/src/index.ts`:**

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import { sendToDaemon } from '@0ctx/mcp/client';
import { resolveContext } from '@0ctx/daemon/resolver';

const program = new Command();
const context = resolveContext(process.cwd());

program
  .name('0ctx')
  .description('Zero context loss across AI tools')
  .version('0.1.0');

program
  .command('start')
  .description('Start the 0ctx daemon')
  .action(() => {
    require('@0ctx/daemon');
  });

program
  .command('set <type> <content>')
  .description('Add a context node (background | decision | constraint | goal | assumption | open_question | artifact)')
  .option('-k, --key <key>', 'Named key for direct lookup')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (type, content, opts) => {
    const node = await sendToDaemon('addNode', {
      context, type, content,
      key: opts.key,
      tags: opts.tags ? opts.tags.split(',') : [],
      source: 'cli',
    });
    console.log(chalk.green('✓'), `Saved node ${chalk.dim(node.id)}`);
  });

program
  .command('get <key>')
  .description('Retrieve a node by named key')
  .action(async key => {
    const node = await sendToDaemon('getByKey', { context, key });
    if (!node) console.log(chalk.yellow('Not found'));
    else console.log(JSON.stringify(node, null, 2));
  });

program
  .command('search <query>')
  .description('Search context nodes')
  .action(async query => {
    const results = await sendToDaemon('search', { context, query, limit: 10 });
    results.forEach((r: any) => console.log(chalk.bold(r.type), r.content));
  });

program
  .command('checkpoint <name>')
  .description('Save a named checkpoint')
  .action(async name => {
    const cp = await sendToDaemon('saveCheckpoint', { context, name });
    console.log(chalk.green('✓'), `Checkpoint: ${chalk.bold(name)} — ${chalk.dim(cp.id)}`);
  });

program
  .command('rewind <checkpointId>')
  .description('Restore graph to a checkpoint')
  .action(async checkpointId => {
    await sendToDaemon('rewind', { checkpointId });
    console.log(chalk.green('✓'), 'Rewound to checkpoint');
  });

program
  .command('checkpoints')
  .description('List checkpoints for the current project')
  .action(async () => {
    const list = await sendToDaemon('listCheckpoints', { context });
    list.forEach((cp: any) => console.log(chalk.dim(cp.id), chalk.bold(cp.name), new Date(cp.createdAt).toLocaleString()));
  });

program
  .command('handoff')
  .description('Export context packet for handoff')
  .action(async () => {
    const result = await sendToDaemon('getSubgraph', { rootId: context, depth: 99 });
    console.log(JSON.stringify(result, null, 2));
  });

program.parse();
```

---

## Step 6 — `packages/ui`

Stub the UI package. Full implementation comes later — this wires up the local HTTP server served by the daemon.

```bash
mkdir -p packages/ui/src
cd packages/ui && npm init -y
npm install express
```

**`packages/ui/src/index.ts`** — placeholder:

```typescript
import express from 'express';

export function startUI(port = 7842) {
  const app = express();
  app.use(express.json());

  app.get('/', (_, res) => {
    res.send('<h1>0ctx UI</h1><p>Full graph UI coming soon.</p>');
  });

  app.listen(port, () => {
    console.log(`0ctx UI at http://localhost:${port}`);
  });
}
```

---

## Step 7 — `packages/sync`

Stub only. Wire this up when starting the SaaS layer.

```bash
mkdir -p packages/sync/src
cd packages/sync && npm init -y
```

**`packages/sync/src/index.ts`:**

```typescript
// Sync package — stub
// Will handle encrypted diff push/pull to 0ctx cloud
export function startSync() {
  console.log('Sync not yet configured.');
}
```

---

## Step 8 — `.env.example`

```env
# Daemon
CTX_SOCKET_PATH=~/.0ctx/0ctx.sock
CTX_DB_PATH=~/.0ctx/0ctx.db
CTX_UI_PORT=7842

# Cloud sync (SaaS — leave blank for local-only)
CTX_CLOUD_URL=
CTX_CLOUD_KEY=
```

---

## Step 9 — `README.md`

```markdown
# 0ctx

Zero context loss across AI tools.

A persistent local daemon that holds your project reasoning as a knowledge graph.
Any MCP-compatible tool connects to it — Claude Desktop, Cursor, Claude Code — 
and inherits full context instantly.

## Quick Start

\`\`\`bash
npm install
npm run build
0ctx start          # start the daemon
\`\`\`

## Add to any MCP tool

\`\`\`json
{
  "mcpServers": {
    "0ctx": { "command": "0ctx", "args": ["connect"] }
  }
}
\`\`\`

## CLI

\`\`\`bash
0ctx set decision "Using Postgres for full-text search needs" --key db-choice   # developer
0ctx set constraint "Client requires UK jurisdiction" --key jurisdiction            # lawyer
0ctx set background "Brand tone: warm, direct, no jargon" --key brand-tone          # designer
0ctx get db-choice
0ctx search "auth"
0ctx checkpoint "before-refactor"
0ctx rewind <checkpointId>
0ctx handoff
\`\`\`

## Open the UI

Once the daemon is running: http://localhost:7842
```

---

## Build Order

Follow this sequence strictly — each package depends on the previous:

1. `packages/core` — graph engine, no dependencies on other packages
2. `packages/daemon` — depends on core
3. `packages/mcp` — depends on daemon
4. `packages/cli` — depends on daemon
5. `packages/ui` — depends on daemon
6. `packages/sync` — standalone stub, wire up last

---

## Key Constraints to Respect

- **Local-first always** — the daemon and SQLite are the source of truth. Cloud is additive, never required.
- **No Postgres locally** — SQLite only. Postgres is for the cloud backend (`0ctx-cloud` repo), never the local product.
- **Context isolation is hard** — nodes always carry a `context` key. Never query across contexts unless explicitly requested. A context is universal — a case, a brief, a project, a research thread, anything.
- **MCP tools must be stateless** — the MCP server itself holds no state. All state lives in the daemon.
- **The graph is append-mostly** — prefer adding `supersedes` edges over deleting old nodes. Preserve history.
- **Node types are universal** — `background`, `decision`, `constraint`, `goal`, `assumption`, `open_question`, `artifact`. Never add developer-specific types. The schema must work for a lawyer, a designer, and a developer equally.
- **Auto-extraction is an interceptor** — it watches conversation streams and calls `ctx_set` automatically. Build this after the core MCP tools are stable.

---

*0ctx.com — confidential*
