# uniblox-take-home

TypeScript + Express 5 + Prisma 7 + PostgreSQL (local, no Docker).

## Setup

```bash
brew services start postgresql@17
createdb uniblox
cp .env.example .env   # set your Postgres user
npm install            # also runs prisma generate
```

## Scripts

- `npm run dev` — start with auto-restart (nodemon + tsx)
- `npm run build` / `npm start` — compile to `dist/` and run
- `npm run db:migrate` — create/apply migrations after editing `prisma/schema.prisma`
- `npm run db:studio` — browse data

`GET /health` checks the server and DB connection.
