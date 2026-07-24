# Trainer App

Single-user, local-first personal training app built with Next.js App Router, Prisma, and Postgres.

## Documentation
- Start here: [docs/00_START_HERE.md](docs/00_START_HERE.md)

## Quickstart
1. From `trainer-app/`, install the exact lockfile deliberately:
```bash
npm ci
```
2. Configure environment:
```bash
cp .env.example .env
```
3. Generate Prisma client:
```bash
npm run prisma:generate
```
4. Apply migrations only through the separately authorized local development or deployment workflow in [docs/07_OPERATIONS.md](docs/07_OPERATIONS.md).
5. Optional seed:
```bash
npm run db:seed
```
6. Run dev server:
```bash
npm run dev
```
7. Run tests:
```bash
npm test
```
