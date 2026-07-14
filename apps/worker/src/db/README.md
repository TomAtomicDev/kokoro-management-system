# db/

Drizzle ORM schema (`schema.ts`), drizzle-kit-generated migrations (`../../migrations/`), and the
D1 client factory (`index.ts`). Schema definitions here mirror the DDL in
`docs/system-design-knowledge-base/04-data-model.md` 1:1 (Doc 04 header rule) — if they ever
disagree, the migration SQL wins and this file must be corrected to match (D-6).

- `schema.ts` — table definitions for typed queries. Views live only in the SQL migration.
- `seed-fixtures.sql` — dev/staging-only demo catalog + recipes (Doc 04 §7); run via
  `pnpm run db:seed:dev` / `db:seed:staging`, never applied to prod.
- `index.ts` — `createDb(d1)` factory core/ services import for a typed `DrizzleD1Database`.
