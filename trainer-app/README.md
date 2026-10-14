# Trainer App

Single-user personal training app built with Next.js App Router, Prisma and PostgreSQL.

## Quickstart

Start with the repository [AGENTS.md](../AGENTS.md) and
[task and verification guide](../scripts/codex/README.md#task-and-verification).
Use a task-isolated cloud checkout; Aaron's PC and a local database are not prerequisites for editing.

From `trainer-app/`, install the committed lockfile with `npm ci`, then run
`npm run test -- <owning-test-paths>` for the affected code. Publish an authorized draft early;
the existing PR workflow owns the full hosted inventory and disposable acceptance.

Environment configuration, development servers, migrations and optional seeds belong to the
explicitly authorized workflow in [operations](docs/07_OPERATIONS.md#authorized-development-environment).
Do not copy credentials or run `db:seed` as routine startup.

The [domain index](docs/00_START_HERE.md) links the detailed architecture and feature contracts.
