# 0ctx Desktop Design Brief

## Copy-Paste Brief

Design a **local-first desktop app** for AI work memory and project continuity.

The product is called **0ctx**. It captures AI sessions from tools like **Droid / Factory**, **Codex**, and **Antigravity**, then organizes them by **workspace**, **branch**, **session**, **message**, **checkpoint**, and **knowledge**.

This is **not** a chat app and **not** a raw developer console. It is a **desktop control center for understanding project work across branches, agents, and checkpoints**.

We want a design that feels:

- modern desktop-native
- compact and readable
- calm, dense, and high-signal
- suitable for daily use by engineers
- closer to a polished productivity tool than an internal admin panel

The current app is too technical, too path-heavy, and explains itself too much before showing useful information. The redesign should make the product understandable at a glance.

Primary daily surfaces should be:

1. Workspaces
2. Branches
3. Sessions
4. Checkpoints
5. Knowledge
6. Setup

The main experience should be **branch-first**:

`Workspace -> Branch lane -> Sessions -> Messages -> Checkpoints -> Knowledge`

The designer should treat:

- `Workspace` = one project or repository
- `Branch lane` = one branch or worktree within a project
- `Session` = one AI run on that branch
- `Message` = one transcript-derived event inside a session
- `Checkpoint` = a restore/explain point linked to branch + session + commit
- `Knowledge` = extracted decisions, constraints, goals, assumptions, questions, artifacts

Important product rules:

- Local SQLite + daemon are the source of truth
- Raw payloads exist, but they should stay secondary and on-demand
- Source file paths and raw hook artifacts should not dominate the default workflow
- Multiple agents can work on the same branch; the product should make handoff between agents obvious
- Branches inside one project are parallel workstreams, not separate workspaces

The design should solve these jobs:

1. Understand what happened on a project recently
2. See which branch is active and which agent worked on it
3. Open a session and read the conversation as a human, not as JSON
4. See how sessions connect to commits and checkpoints
5. Resume from a known checkpoint or explain how a branch got here
6. Use setup/diagnostics only when needed, not as the main product surface

We need:

- information architecture
- navigation system
- desktop layout system
- component library / tokens
- empty/loading/error/offline states
- high-fidelity designs for the key screens
- interaction guidance for dense desktop usage

Target platforms:

- Windows and macOS first
- Linux later

Window assumptions:

- typical desktop/laptop use
- should feel good at around `1080x720` and above
- must remain readable on smaller laptop windows

The final design should feel like a serious, production-grade desktop product, not a prototype dashboard.

---

## Product Summary

0ctx is a local-first context engine that preserves continuity across AI tools.

It captures work from multiple agents, stores it locally, and lets the user inspect:

- which branch was worked on
- which agent worked on it
- what the actual conversation was
- what commit/checkpoint came from it
- what durable knowledge was extracted

This is a **project memory system**, not a generic note-taking app and not a terminal wrapper.

---

## What The Current Desktop Gets Wrong

The current desktop is functional, but the design direction is wrong for production:

1. It feels like an internal diagnostics console
2. It over-explains instead of showing useful work
3. It gives too much space to setup/runtime details
4. It surfaces long summaries, ids, and technical metadata too early
5. It does not clearly separate daily workflows from support/debug workflows
6. It makes sessions readable only after effort
7. It does not yet make branch lanes or cross-agent handoff visually strong enough

This redesign should fix the information hierarchy, not only the visual styling.

---

## Core Product Objects

### Workspace

One project or repository.

Needed data:

- name
- bound folder path
- sync posture
- current status
- counts for branches, sessions, checkpoints
- last activity

### Branch Lane

One branch or worktree inside a workspace.

Needed data:

- branch name
- optional worktree label/path
- last activity time
- last agent
- latest commit
- session count
- checkpoint count
- handoff signal if multiple agents touched the branch

### Agent Session

One captured run from Droid, Codex, or Antigravity on a branch lane.

Needed data:

- session summary
- agent
- branch
- started at / last activity
- message count
- linked commit
- linked checkpoint if any

### Message

One transcript-derived message in a session.

Needed data:

- role (`user`, `assistant`, or other system event)
- timestamp
- readable content
- optional parent/sequence relation
- raw payload available on demand only

### Checkpoint

One restore/explain unit linked to a branch lane, session, and commit.

Needed data:

- checkpoint summary
- created time
- branch
- session
- commit
- kind/status
- actions: explain, rewind, resume from here

### Knowledge

Derived memory extracted from sessions/checkpoints.

Needed data:

- node type
- title/summary
- relationship to branch/session/checkpoint
- hidden capture nodes kept secondary

---

## Primary User Jobs

### 1. Scan Recent Work

The user opens the app and wants to understand:

- what changed recently
- which branches are active
- which agent worked where

### 2. Read A Session Clearly

The user wants a clean conversation view:

- readable session title
- clear user vs assistant messages
- timestamps
- easy message selection
- raw payload optional, not default

### 3. Understand Branch Continuity

The user wants to know:

- what happened on `main`
- what happened on `feature/x`
- whether Droid started the work and Codex continued it

### 4. Manage Checkpoints

The user wants to:

- create a checkpoint from a session
- understand what a checkpoint represents
- rewind or resume confidently

### 5. Inspect Derived Knowledge

The user wants to read the durable memory extracted from work without reading every full transcript.

### 6. Handle Setup Only When Needed

The user wants setup to feel secondary:

- install hooks
- verify machine state
- debug runtime only when something breaks

---

## Information Architecture

### Primary Navigation

Use these top-level areas:

1. `Workspaces`
2. `Branches`
3. `Sessions`
4. `Checkpoints`
5. `Knowledge`
6. `Setup`

### Navigation Principles

- `Branches` should be the most important daily surface
- `Sessions` should be the main reading surface
- `Checkpoints` should feel like a durable control layer
- `Setup` should feel separate from daily work
- Do not lead with runtime JSON or diagnostics

---

## Required Screens

### 1. Workspaces

Purpose:

- create/select a project
- bind a repo folder
- understand high-level workspace state

Must include:

- workspace list
- create workspace flow
- native folder selection
- current binding and status
- counts and last activity

Should feel like:

- project switcher + project home

### 2. Branches

Purpose:

- show workstreams inside a workspace
- make agent continuity and activity obvious

Must include:

- branch lane list
- branch health/status
- last activity
- latest commit
- last agent
- session count
- checkpoint count
- handoff view or timeline

This should become the default “where am I and what is happening?” screen.

### 3. Sessions

Purpose:

- read captured conversations clearly

Must include:

- session list
- session summary
- agent indicator
- branch context
- message stream
- selected message detail
- raw payload toggle only when explicitly requested

Important:

- design this as a reading experience, not an event log
- user and assistant messages should be visually distinct but subtle
- long content must remain readable

### 4. Checkpoints

Purpose:

- manage durable restore/explain points

Must include:

- checkpoint list
- checkpoint detail
- linked branch/session/commit
- explain action
- rewind action
- resume action

This should feel trustworthy and deliberate, not dangerous or hidden.

### 5. Knowledge

Purpose:

- read extracted memory without reading every conversation

Must include:

- knowledge list or grouped view
- node type indicators
- relation to branch/session/checkpoint
- toggle or secondary access to hidden capture nodes

Avoid making this a raw graph debug page by default.

### 6. Setup

Purpose:

- install hooks
- verify supported agents
- inspect runtime posture if needed

Must include:

- supported agents and install state
- install/repair flows
- local runtime posture
- storage and sync posture
- diagnostics only as secondary details

This screen should exist, but should not dominate the product.

---

## Visual Direction

We want a design with strong desktop-product character.

### Desired Feel

- dark but not muddy
- refined, compact, and information-dense
- modern productivity software
- calm surfaces, high contrast, clear hierarchy
- more “serious tool” than “marketing concept”

### Visual Cues We Want

- compact sidebar / navigation rail
- restrained but intentional accent color use
- strong typography hierarchy
- card and panel system that supports dense data
- clear selected states
- subtle layer depth, not heavy skeuomorphism
- visual distinction between daily-work surfaces and support/diagnostic surfaces

### Visual Cues We Do Not Want

- giant hero sections on every page
- oversize dashboard cards that waste space
- too much instructional copy in primary workflows
- generic “AI app” visuals
- terminal-console aesthetics as the main design language
- raw JSON or file paths dominating the interface

---

## UX Principles

### 1. Content First

The design should show the work itself before explaining the system.

### 2. Compact By Default

This is a desktop productivity app. It should use space efficiently.

### 3. Technical Depth On Demand

Ids, payloads, diagnostics, and source paths belong behind toggles, drawers, or secondary panels.

### 4. Branch-First Mental Model

The app should teach the user that branches are workstreams, sessions are runs, and checkpoints are restore points.

### 5. Cross-Agent Continuity

Multiple agents on one branch should feel like a continuation of work, not separate universes.

### 6. Safety And Trust

Checkpoint actions like rewind should feel explicit, understandable, and reversible.

---

## Important States To Design

Please include designs for:

- empty workspace
- empty branch state
- empty sessions state
- empty checkpoints state
- no hooks installed
- offline runtime
- authenticated vs not authenticated
- capture in progress
- stale or broken setup
- dense project with many branches and sessions
- long conversation content
- small laptop window

---

## Suggested Screen Priorities

If design time is limited, prioritize these in order:

1. Branches
2. Sessions
3. Checkpoints
4. Workspaces
5. Setup
6. Knowledge

---

## Data The UI Must Be Able To Surface

### Workspace level

- workspace name
- folder binding
- sync policy / posture
- capture readiness
- total branches
- total sessions
- total checkpoints
- last activity

### Branch level

- branch name
- worktree if present
- last agent
- last commit
- last activity
- session count
- checkpoint count
- handoff timeline

### Session level

- session summary
- agent
- branch
- start time
- last activity
- message count
- commit if linked

### Message level

- role
- content
- timestamp
- payload available or not

### Checkpoint level

- summary
- branch
- session
- commit
- created at
- explain/rewind/resume actions

### Knowledge level

- type
- summary/title
- source relation

---

## Constraints For The Designer

- Desktop app built with Tauri
- Windows and macOS are first-class targets
- Local-first product; cloud is secondary
- Payload inspection exists, but should not be the default reading mode
- We can rewrite the current desktop shell; do not feel constrained by the current layout
- We care more about information architecture and readability than matching the current implementation

---

## Deliverables Requested From Design

Please provide:

1. Navigation / IA proposal
2. One visual direction with desktop-specific component language
3. High-fidelity screens for:
   - Workspaces
   - Branches
   - Sessions
   - Checkpoints
   - Setup
4. Component system / tokens:
   - typography
   - spacing
   - radii
   - color roles
   - table/list/card patterns
   - badges / chips / timelines / pills / empty states
5. Interaction notes for:
   - selection
   - filtering
   - expanding details
   - on-demand raw payload
   - checkpoint actions
6. Empty, loading, offline, and error states
7. Compact and expanded desktop window examples

---

## Short Notes For The Designer

- Think “project memory and continuity” rather than “chat client”.
- Think “branch lanes and checkpoints” rather than “logs and settings”.
- The app should feel legible in 10 seconds.
- The default screen should help the user answer:
  - What is happening in this project?
  - Which branch is active?
  - Which agent touched it?
  - What session should I open?
  - What checkpoint can I trust?

