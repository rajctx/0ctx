# SLO and Observability Baseline

Updated: 2026-02-24  
Owner: Platform + SRE

This document defines baseline reliability goals and observability requirements for hosted UI, connector bridge, and control-plane operations.

## Service Level Objectives

## Hosted UI availability

- SLO: 99.9% monthly route availability for core paths (`/`, `/dashboard/*`).
- SLI source: synthetic probes + edge/server response telemetry.

## Runtime command reliability

- SLO: 99.5% successful completion for connector-mediated operational commands.
- Scope: register, status, verify, queue status/drain.
- SLI source: BFF endpoint success/error counters with correlation IDs.

## Queue replay latency

- SLO: 95% of queued events drained within 5 minutes after connectivity recovery.
- SLI source: queue depth and drain duration telemetry.

## Observability Requirements

- Structured logs for:
  - auth/session events
  - BFF request lifecycle
  - connector bridge commands
  - error envelopes with correlation IDs
- Metrics:
  - request rate, error rate, p95/p99 latency
  - connector posture distribution (`connected/degraded/offline`)
  - queue depth and drain timings
- Tracing:
  - browser action -> BFF -> control plane -> connector command path

## Alerting Baseline

- Critical:
  - hosted UI unavailable
  - auth callback failures above threshold
  - sustained connector offline posture across active tenants
- Warning:
  - elevated queue depth
  - rising retries/timeouts in command bridge

## Incident Handling

1. Detect via alerts or synthetic checks.
2. Correlate with deployment and infra changes.
3. Mitigate (rollback or feature flag).
4. Post-incident analysis and runbook update.

## Ownership

- UI Platform: hosted route correctness and BFF behavior.
- Cloud Platform: control-plane API health and capacity.
- Runtime Platform: connector/daemon bridge reliability.
- Security: auth/session and policy enforcement anomalies.
