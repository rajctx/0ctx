# 0ctx Desktop Visual Direction

## Reference Direction

Use the attached inspiration as the **visual mood and density reference**, not as a literal product structure.

What we want from that reference:

- warm, soft, desktop-native palette
- compact left navigation
- restrained typography
- subtle borders instead of heavy shadows
- dense but calm information layout
- rounded pills for status, agent, branch, and checkpoint metadata
- clean list/card hybrids instead of giant dashboard tiles
- a productivity-tool feel, not a console or monitoring dashboard feel

What we do **not** want to copy directly:

- note-taking app semantics
- generic “library” wording
- cards that hide branch/session hierarchy
- decorative UI that reduces scan speed

0ctx is a **project memory system**, so the design needs to express:

- branch lanes
- multi-agent handoff
- sessions and message streams
- checkpoints
- knowledge extracted from work

---

## Share This To Design

Design the 0ctx desktop app using a visual direction similar to the attached inspiration:

- warm off-white / beige canvas
- subtle dividers
- white cards
- compact spacing
- soft neutral typography
- colored pills/chips for metadata
- left sidebar with small section labels
- very readable desktop-product hierarchy

The app should feel like a refined macOS/Windows productivity app, not a devtools console.

But the product structure is different from the inspiration. 0ctx is not a notes app. It is a **local-first project memory and continuity system** for AI-assisted work.

The core hierarchy is:

`Workspace -> Branch lane -> Sessions -> Messages -> Checkpoints -> Knowledge`

So the design should adapt the inspiration’s visual language to these real product objects:

### Workspace

One project or repository.

### Branch lane

One branch or worktree inside the workspace.

### Session

One AI run by Droid / Factory, Codex, or Antigravity on a branch lane.

### Message

One readable transcript-derived message inside a session.

### Checkpoint

A restore/explain point linked to a branch, session, and commit.

### Knowledge

Derived decisions, constraints, goals, assumptions, questions, and artifacts.

---

## Exact Visual Cues To Use

### Layout

- narrow but usable left sidebar
- clean top header with breadcrumbs and a few actions
- main scrollable content area
- sections separated by whitespace and subtle rules
- avoid oversized hero panels

### Sidebar

- workspace switcher at top
- compact grouped navigation
- small colored dots or pills to indicate workspace/project identity
- lightweight counts on the right where useful

### Main Area

- use section headers like:
  - `Active Branches`
  - `Recent Sessions`
  - `Recent Checkpoints`
  - `Knowledge Context`
- prioritize scan-friendly blocks over dense technical tables

### Cards / Rows

- cards should be low-chrome
- white or near-white surfaces on a warm neutral background
- soft radius
- subtle border
- very light hover state

### Pills / Chips

Use pill components heavily for:

- branch
- agent
- checkpoint status
- sync state
- knowledge tags
- commit shorthand

Good pill palette directions:

- green for healthy / active / verified
- beige for neutral metadata
- blue for Droid / system / linked context
- purple for Codex or handoff state
- pink/red only for warning/error
- orange for pending / draft / needs attention

### Typography

- desktop-native sans stack is fine
- compact sizes
- strong but restrained hierarchy
- titles should feel crisp and practical, not marketing-heavy

### Motion

- minimal
- hover/focus transitions only
- no flashy animation system

---

## Product-Specific Adaptation

This is where the inspiration needs to be adapted to 0ctx:

### 1. Branches Should Be The Primary Daily Surface

The designer should turn the inspiration’s “content cards” into **branch lane cards**.

Each branch lane card should show:

- branch name
- short work summary
- last commit shorthand
- last activity time
- agent chain or last agent
- checkpoint count / session count

### 2. Sessions Should Feel Readable

The sessions view should not look like raw events.

It should feel closer to:

- session list on the left
- message stream in the middle
- selected message / session context on the right

But in the same warm, compact visual language.

### 3. Checkpoints Should Feel Valuable

Checkpoint rows or cards should show:

- checkpoint name
- status
- linked branch
- linked session
- commit short hash
- created time

And actions like:

- Explain
- Rewind
- Resume

These actions must feel deliberate and trustworthy.

### 4. Knowledge Should Be Summaries First

Knowledge is not a raw graph debug page.

It should feel like:

- categorized memory
- extracted insights
- tags and relation pills
- graph detail only when the user asks for it

### 5. Setup Should Be Secondary

Setup can use the same visual system, but should read like:

- supported agents
- installed / missing / planned states
- machine readiness
- sync/runtime posture

Not:

- JSON wall
- diagnostics dashboard as the main experience

---

## Suggested Screen Direction

### Screen 1: Branch Overview

Use the inspiration’s card-grid rhythm.

Translate it into:

- active branches section
- each card = one branch lane
- show branch name, summary, recent agent handoff, last activity

Below that:

- recent checkpoints
- knowledge context

### Screen 2: Sessions

Use a three-panel reading workflow:

- left: session list
- center: message stream
- right: selected context / checkpoint / raw payload toggle

Still use the same soft palette, pills, and compact hierarchy.

### Screen 3: Checkpoints

Use a list + detail pattern:

- checkpoint list
- selected checkpoint detail
- clear actions

### Screen 4: Workspaces

Use a project-library feel:

- workspace switcher/list
- folder binding
- branch/session/checkpoint counts
- last activity

---

## Design Constraints

- Do not design around giant dashboards.
- Do not make the main screen look like logs, tracing, or backend ops.
- Do not overuse dark mode for the main direction in this pass.
- Optimize for human readability over technical completeness.
- Keep the design practical for implementation in Tauri/HTML/CSS.

---

## Deliverable We Want

Please propose a full design direction for 0ctx desktop using this inspiration’s warmth, density, and calmness, but adapted for:

- workspaces
- branch lanes
- sessions
- checkpoints
- knowledge
- setup

We want:

1. navigation concept
2. design system / color and type tokens
3. high-fidelity key screens
4. compact desktop states
5. empty/loading/offline/error states
6. a clear daily workflow for engineers using multiple AI agents on the same project

