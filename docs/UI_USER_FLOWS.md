# UI User Flows

Updated: 2026-02-22

This document describes the core route-by-route user journeys within the 0ctx UI proxy dashboard.

---

## 1. Authentication Flow

**Scenario:** A user accesses the dashboard for the first time.
**Primary Route:** `/` -> `/api/auth/login` -> `/dashboard`

1. **Entry:** User navigates to the proxy root (`/`) or directly attempts to access `/dashboard`.
2. **Access Check:** 
   - If landing on `/`, the user clicks the "Sign In" or "Get Started" call-to-action.
   - If landing on `/dashboard`, the Next.js standard middleware detects a missing session and automatically redirects the user to the login route.
3. **Universal Login:** The Auth0 universal login page prompts the user for credentials (username/password or enterprise SSO).
4. **Callback & Session Initialization:** Upon successful authentication, Auth0 redirects the user back to the application callback route (`/api/auth/callback`). An encrypted, httpOnly session cookie is generated.
5. **Dashboard Access:** The user is redirected to `/dashboard/workspace`. The `DashboardShell` fetches the user profile using the `@auth0` SDK, displaying their avatar and email in the user profile menu.

---

## 2. Workspace & Graph Interaction Flow

**Scenario:** A user wants to explore their project's knowledge graph and add a new context node.
**Primary Route:** `/dashboard/workspace`

1. **Context Selection:**
   - The user opens the left sidebar.
   - The application fetches the list of available workspaces (`listContexts`) from the daemon.
   - The user clicks on "Acme Corp Project". The shell calls `switchContext` to update the active session state.
2. **Graph Visualization:**
   - The Workspace view components fetch the graph data (`getGraphData`) for the active context.
   - The interface renders nodes and connecting edges using a force-directed visualizer.
3. **Node Exploration:**
   - The user hovers over a node to see its title/summary.
   - The user clicks a node. The right-hand "Node Inspector" panel slides into view, displaying the full node details (content, type, tags, creation date, relationships).
4. **Node Creation:**
   - The user clicks the floating "Add Node" action button.
   - A modal form asks for node details: type (e.g., `decision`), content (markdown text), and optional tags.
   - Upon submission, the UI calls `addNode` via the proxy router, adding it to the daemon database.
   - The `sync-engine` is triggered automatically, queueing this change for encrypted push.
5. **Edge Linking:**
   - The user can select the newly created node, enter "Link Mode", and click an existing node to draw a directed relationship (e.g., `depends_on`). The UI calls `addEdge`.

---

## 3. Sync & Daemon Observability Flow

**Scenario:** A user wants to ensure their local changes have been backed up to the remote sync server.
**Primary Route:** All `/dashboard/*` routes (Header section)

1. **Continuous Health Check:** The desktop runs a lightweight intermittent poll against the daemon's `health` endpoint.
2. **Status Ribbon Indicators:**
   - The top navigation bar displays a summary: `Connected`, `Degraded`, or `Offline`.
   - Hovering over the status pill shows detailed metrics from `metricsSnapshot`.
3. **Sync Observability:**
   - If the sync engine is enabled (`sync.enabled: true`), the header strip displays the sync queue status (e.g., `2 pending`, `1 in-flight`).
   - The user sees real-time feedback as the queue empties.
   - If a sync push fails repeatedly, a warning indicator displays the last sync error fetched from `syncEngine.getStatus()`.
4. **Manual Trigger:** The user can click a "Sync Now" button in the status popover interface, which invokes the `syncNow` daemon command and forces an immediate drain attempt.

---

## 4. Diagnostics & Remediation Flow

**Scenario:** The user notices the daemon status is `Offline` or acting degraded and wants to investigate.
**Primary Route:** `/dashboard/operations`

1. **Initiate Diagnostics:** 
   - The user navigates to "Operations".
   - The UI displays a list of available runbook scripts (powered by the CLI tool).
2. **Run Doctor:**
   - The user clicks "Run Diagnostics (`0ctx doctor`)".
   - The proxy invokes the underlying CLI diagnostic command. The UI streams the output logs directly into an integrated terminal component on the page.
3. **Take Action:** 
   - If the doctor script identifies an issue (e.g., SQLite DB permissions issue), it suggests a repair command.
   - The user clicks "Attempt Auto-Repair (`0ctx repair`)". The terminal streams the repair progress.
4. **Status Recovery:** 
   - Upon successful execution, the global dashboard health poll immediately detects the system is back online, resolving the offline warning notification.

---

## 5. Audit View Flow

**Scenario:** The user needs to understand who (or what AI agent) made a specific architectural decision node.
**Primary Route:** `/dashboard/audit`

1. **Log Access:** The user navigates to the "Audit Log" tab.
2. **Data Fetching:** The UI requests `listAuditEvents`, scoped to the currently active context.
3. **Inspection:** 
   - The user sees a paginated table of recent changes: timestamps, the exact graph operations (`addNode`, `addEdge`), and the `source` associated with the event (e.g., `cli`, `0ctx-mcp`, or the user's dashboard interaction).
   - The user filters the table by the `decision` node type to locate exactly when the disputed node was added.
