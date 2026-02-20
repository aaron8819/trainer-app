# Trainer App

Single-user, local-first personal training app built with Next.js App Router, Prisma, and Postgres.

## Documentation
- Start here: [docs/00_START_HERE.md](docs/00_START_HERE.md)

## Quickstart
1. Install dependencies:
```bash
npm install
```
2. Configure environment:
```bash
cp .env.example .env
```
3. Generate Prisma client:
```bash
npm run prisma:generate
```
4. Apply migrations:
```bash
npx prisma migrate deploy
```
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
