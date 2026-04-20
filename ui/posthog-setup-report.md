<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the 0ctx marketing site (Next.js 16.1.6, App Router).

## Summary of changes

- **`src/instrumentation-client.ts`** (new): Client-side PostHog initialization using the Next.js 15.3+ `instrumentation-client.ts` pattern. Initializes PostHog with a reverse proxy (`/ingest`), exception capture enabled, and debug mode in development.
- **`next.config.ts`**: Added PostHog reverse proxy rewrites (`/ingest/static/*`, `/ingest/array/*`, `/ingest/*`) and `skipTrailingSlashRedirect: true` to support PostHog ingestion through the Next.js server. Existing Sentry config preserved.
- **`src/components/landing/copy-command.tsx`**: Added `install_command_copied` event capture inside the existing `copy` handler. Tracks the `command` property to differentiate copies from different placements.
- **`src/components/landing/workflow-steps.tsx`**: Added `workflow_step_engaged` event capture inside the IntersectionObserver callback when a new step becomes visible. Tracks `step_id`, `step_name`, and `step_index`.
- **`.env.local`**: Added `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` environment variables.

## Events

| Event | Description | File |
|-------|-------------|------|
| `install_command_copied` | User clicked to copy the CLI install command — primary conversion signal indicating intent to install 0ctx | `src/components/landing/copy-command.tsx` |
| `workflow_step_engaged` | User scrolled through and engaged with a workflow step in the "How it works" section on the landing page | `src/components/landing/workflow-steps.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics](https://us.posthog.com/project/329096/dashboard/1489006)
- **Insight**: [Install command copies over time](https://us.posthog.com/project/329096/insights/e7lU9fq7)
- **Insight**: [Unique users copying install command](https://us.posthog.com/project/329096/insights/dJqiO2uh)
- **Insight**: [Workflow step engagement breakdown](https://us.posthog.com/project/329096/insights/dIm3ItqQ)
- **Insight**: [Landing → Install conversion funnel](https://us.posthog.com/project/329096/insights/mr6p34mr)
- **Insight**: [Total install command copies (30 days)](https://us.posthog.com/project/329096/insights/R7YafN5V)

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
