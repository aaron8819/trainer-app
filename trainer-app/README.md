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

## Documentation

See [docs/index.md](docs/index.md) for the full documentation map. Key references:

- [docs/architecture.md](docs/architecture.md) — Engine behavior, guarantees, generation flow
- [docs/data-model.md](docs/data-model.md) — Database schema reference
- [docs/seeded-data.md](docs/seeded-data.md) — Exercise catalog and seed data

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
