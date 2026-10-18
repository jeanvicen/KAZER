# Server-side modules

This directory contains the implementation behind the Vercel HTTP adapters in `api/`.
The domain folders are deliberately separate from route registration: adding or moving a
module here does not create a new HTTP endpoint.

| Folder | Responsibility |
|---|---|
| `agent/` | Brain, task context, instructions, Skills, and isolated terminal adapter. |
| `integrations/` | GitHub, Google Drive, MCP, and plugin runtimes. |
| `research/` | Search orchestration, browser research, evidence helpers, and live context. |
| `security/` | Request security, URL/IP validation, and SSRF protections. |
| `storage/` | Supabase/data access shared by server routes. |
| `tasks/` | Workspace task handlers and background-task context. |
| `usage/` | Usage policy and billing/limit helpers. |

`api/_*.js` files are intentionally retained as one-line compatibility adapters for
existing imports and test harnesses. Put implementations in this directory; do not add a
second copy of business logic under `api/`. Route URLs remain defined by the existing
`api/*.js` handlers and `vercel.json`.
