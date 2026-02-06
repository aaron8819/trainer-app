Trainer App is a Next.js-based personal training assistant with a programmable workout engine, exercise database, and PPL (push/pull/legs) generation logic.

## Quick Start

Install dependencies:

```bash
npm install
```

Generate Prisma client:

```bash
npm run prisma:generate
```

Run the dev server:

```bash
npm run dev
```

Open `http://localhost:3000` to view the app.

## Key Engine Docs

- `trainer-app/docs/workout-engine.md` : current behavior and end-to-end flow
- `trainer-app/docs/engine_refactor` : refactor goals + acceptance criteria
- `trainer-app/docs/engine_refactor_clarifications` : authoritative decisions
- `trainer-app/docs/engine-schema-behavior.md` : schema + behavior reference
- `trainer-app/docs/ppl_programmingguidelines` : programming rules for strict PPL
- `trainer-app/docs/ppl-exercise-options.md` : export of live DB exercise options

## Scripts

- `npm run dev` : start development server
- `npm run test` : run engine unit tests
- `npm run prisma:generate` : generate Prisma client
- `npm run db:seed` : seed baseline data and exercises
- `npm run export:ppl-options` : export PPL options from DB

## Database Migrations

This project uses Prisma. For the current refactor migration, apply the SQL directly and mark the migration as applied:

```bash
npx prisma db execute --file prisma/migrations/20260204_engine_refactor/migration.sql
npx prisma migrate resolve --applied 20260204_engine_refactor
```

Then run the exercise migration script:

```bash
npx tsx scripts/migrate-exercises.ts
```

## Environment

The app expects a `DATABASE_URL` in `trainer-app/.env`. See `trainer-app/.env.example` for a template.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
