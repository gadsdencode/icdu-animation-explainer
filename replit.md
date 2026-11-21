# ICDU — AI Guided by Intent

An interactive architecture explorer explaining enterprise AI readiness and governance through animated request simulations.

## Run & Operate

- `pnpm --filter @workspace/icdu-explorer run dev` — run the explorer through its managed web workflow
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- The explorer is an educational, frontend-only simulation, not a real clinical decision system or production AI gateway. It does not call model providers or require a database.
- Blocked requests must never enter model execution; their gate decisions still proceed to the illustrative audit evidence record.

## Product

ICDU means "AI Guided by Intent" and is presented as an enterprise AI readiness and governance control plane. The explorer follows Input → Define → Gate → Execute → Audit, with compliant and missing-context scenarios, playback controls, a synchronized payload inspector, and a with/without-governance comparison.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
