# uniblox-take-home

TypeScript + Express 5 + Prisma 7 + PostgreSQL (local, no Docker).

## Setup

```bash
brew services start postgresql@17
createdb uniblox
cp .env.example .env   # set your Postgres user
npm install            # also runs prisma generate
npm run db:migrate     # apply migrations
npm run db:seed        # seed 5 products (safe to re-run)
npm run dev
```

## Scripts

- `npm run dev` — start with auto-restart (nodemon + tsx)
- `npm run build` / `npm start` — compile to `dist/` and run
- `npm run db:migrate` — create/apply migrations after editing `prisma/schema.prisma`, then regenerate the client
- `npm run db:seed` — upsert seed products (resets their price and stock)
- `npm run db:studio` — browse data

## API

Import `postman/uniblox.postman_collection.json` into Postman. Run "Create cart" first; it saves the cart id for the other requests.

| Method | Path | Success |
|--------|------|---------|
| GET | `/health` | 200 |
| GET | `/products` | 200 |
| GET | `/products/:productId` | 200 |
| POST | `/carts` | 201, the new cart |
| GET | `/carts/:cartId` | 200 |
| POST | `/carts/:cartId/items` `{ productId, quantity }` | 200, the cart (adds to existing quantity) |
| PATCH | `/carts/:cartId/items/:productId` `{ quantity }` | 200, the cart |
| DELETE | `/carts/:cartId/items/:productId` | 200, the cart |

Errors always look like `{ "error": { "code", "message", "details?" } }`:

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Bad body or path params (`details` lists each field) |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 404 | `PRODUCT_NOT_FOUND`, `CART_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `ROUTE_NOT_FOUND` | Resource doesn't exist |
| 409 | `INSUFFICIENT_STOCK` | Requested quantity exceeds current stock |
| 500 | `INTERNAL_ERROR` | Unexpected failure |
