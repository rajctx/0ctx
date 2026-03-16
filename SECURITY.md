# Security Policy

## Supported Versions

Security fixes are applied to:

- `main`
- The latest published `@0ctx/cli` release

Older releases and unreleased forks may not receive backports.

## Reporting a Vulnerability

- Do not open a public issue for a suspected vulnerability.
- Use GitHub private vulnerability reporting for this repository if it is enabled.
- If private reporting is unavailable, open a general support request asking for
  a private contact channel without including exploit details.

Include the following when possible:

- affected version or commit
- impact summary
- reproduction steps or proof of concept
- proposed mitigation or patch direction

## Response Expectations

- Maintainers will acknowledge a valid report as soon as practical.
- Fix timing depends on severity, exploitability, and maintainer availability.
- Public disclosure should wait until a fix or mitigation is available.

## Telemetry and Hosted Integrations

- A clean source build does not send CLI telemetry unless it is explicitly enabled and configured.
- The hosted UI does not initialize Sentry unless `NEXT_PUBLIC_SENTRY_DSN` is set.
- When reporting a vulnerability, mention whether the issue affects the local runtime, the CLI package, or optional hosted/dev surfaces such as `ui/`, `desktop-app/`, or `cloud/`.
