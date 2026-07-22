# PetScape / TinyHabitat AI

PetScape explores a difficult product question: how can a pet owner move from a photo and a rough idea to a spatially checked, manufacturable object without having to understand 3D software?

The repository is a portfolio snapshot of the product and engineering work behind that question. It combines a visual Next.js experience, a 3D scene editor, durable project and asset models, background jobs, and a deliberately sandboxed commerce flow.

![PetScape product walkthrough](docs/operations/wp-2-1-landing-check/branch-wp-2-1.png)

## What is implemented

- A product landing experience and interactive catalogue of pet-space modules.
- A browser-based 3D viewer for model inspection, placement, scale, and scene confirmation.
- PostgreSQL-backed users, pets, projects, private assets, jobs, confirmations, quotes, addresses, sandbox payments, and orders.
- A separate worker process with leases, heartbeats, retries, orphan recovery, and idempotent result handling.
- Private object-storage integration and signed upload/download paths.
- Contract tests, PostgreSQL integration tests, browser tests, container builds, and fail-closed CI/deploy gates.

## Honest status

This is not a live store and does not claim a completed manufacturing business.

- The quote → address → payment → order path uses a sandbox payment provider only.
- Real payment, production scheduling, logistics, and fulfilment remain disabled.
- Some image/3D generation providers are represented by adapters or archived prototype evidence; a local run does not need their paid API keys unless that specific real-provider path is invoked.
- The fastest public demo is the landing page and local 3D interaction. Authenticated persistence and worker flows require PostgreSQL; object upload requires compatible object storage.

## Run the portfolio demo

Requirements: Node.js 24.7+, pnpm 10.23+, and about 4 GB of free disk space for dependencies and the included 3D assets.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev:web
```

Open <http://localhost:3000/?mock=1>. The public landing and pre-baked 3D assets work without paid provider credentials. Generation actions that create a user project require the authenticated stack described below.

### Full local stack

1. Start PostgreSQL 16 and set `DATABASE_URL` in `.env`.
2. Generate the Prisma client and apply migrations:

   ```bash
   pnpm --filter @petscape/server db:generate
   pnpm --filter @petscape/server db:migrate:deploy
   ```

3. Start the web and worker processes in separate terminals:

   ```bash
   pnpm dev:web
   pnpm dev:worker
   ```

Local auth defaults to log-only OTP delivery. The development server prints the code; it does not send a real SMS or email. Keep `PAYMENT_PROVIDER_MODE=disabled` unless you are deliberately running the documented local sandbox tests.

## Architecture

```text
Browser
  └─ Next.js web app / route handlers
       ├─ application services + Zod contracts
       ├─ PostgreSQL / Prisma
       ├─ private object storage
       └─ durable job table
             └─ worker process
                  ├─ mesh analysis / render handlers
                  └─ idempotent asset results
```

The system is split into three workspace packages:

- `web/` — product UI and HTTP boundary.
- `packages/server/` — domain, application, contracts, database, auth, storage, and job infrastructure.
- `worker/` — an independently deployable background process; it does not depend on Next.js or React.

Product truth lives in [`PetScape-PRD.md`](PetScape-PRD.md). System boundaries and data ownership live in [`ARCHITECTURE.md`](ARCHITECTURE.md). Implemented relational truth lives in [`packages/server/prisma/schema.prisma`](packages/server/prisma/schema.prisma).

## Engineering highlights

- Shared Zod contracts keep browser routes, application services, and workers aligned.
- PostgreSQL `SKIP LOCKED`, leases, heartbeats, and attempt fencing prevent duplicate or late worker writes.
- Payment and order recovery use stable idempotency keys and explicit attention states.
- CI separates a fast merge gate from broader browser regression and fails closed for unknown change types.
- Deploys bind images and migrations to an exact commit; production sandbox payments are rejected by configuration.

## Verification

```bash
pnpm validate:docs
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Database-backed integration and browser suites require a migrated PostgreSQL 16 database. Tests that need external object storage or a browser document their required environment variables and fail explicitly when the dependency under test is missing.

## Repository map

- `docs/decisions/` — architecture decision records.
- `docs/specs/` and `docs/plans/` — bounded slices and acceptance criteria.
- `docs/evidence/` and `docs/operations/` — selected behaviour evidence; sensitive infrastructure details are omitted from this public snapshot.
- `assets-3d/` and `web/public/` — portfolio-safe reference and demo assets.
- `.github/workflows/` and `deploy/` — CI, container, migration, and release mechanics.

## Security and reuse

Secrets belong in local environment files or repository secret storage; `.env.example` contains placeholders only. Vendor upload tokens, signed download URLs, production account identifiers, private hostnames, and real test-user details are intentionally excluded from this public history.

This portfolio snapshot does not currently grant an open-source licence. Please contact the author before reusing code or assets.
