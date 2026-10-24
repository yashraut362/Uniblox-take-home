# Uniblox Checkout & Rewards Service

Backend for an ecommerce store: carts, checkout, inventory, and a discount coupon unlocked after every n-th order. Built to stay correct when requests are retried or run at the same time.

**Stack:** TypeScript · Express 5 · Prisma 7 · PostgreSQL · Vitest

## Demo

https://github.com/user-attachments/assets/78f19acd-5fa6-4e9b-83cc-6154fe248eee

## Quick start

Requires **Node.js 22.12+** and **PostgreSQL 14+** running locally. No Docker.

```bash
createdb uniblox
cp .env.example .env          # set your Postgres user in DATABASE_URL
npm install
npx prisma migrate deploy
npm run db:seed               # 5 products, one with only 3 in stock
npm run dev                   # http://localhost:3000
```

Configure the coupon rule in `.env`: `COUPON_EVERY_N_ORDERS` (n) and `COUPON_PERCENT` (x). With the defaults, every 5th order unlocks a 10% coupon.

## Tests

```bash
npm test
```

15 tests that call the real API against a real Postgres database (`uniblox_test`, created automatically, so your dev data is never touched). They cover the risky cases: concurrent checkouts competing for the last items, retried checkouts, two checkouts racing for one coupon, a checkout failing after a coupon was applied, and the report reconciling with orders and coupons.

## API at a glance

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/products`, `/products/:id` | List or get products |
| POST | `/carts` | Create a cart |
| GET | `/carts/:id` | View a cart with live prices and totals |
| POST | `/carts/:id/items` | Add a product |
| PATCH | `/carts/:id/items/:productId` | Set a quantity |
| DELETE | `/carts/:id/items/:productId` | Remove a product |
| POST | `/carts/:id/checkout` | Place the order, with an optional `couponCode` |
| GET | `/orders/:id` | View an order |
| POST | `/admin/coupons` | Generate the next earned coupon |
| GET | `/admin/coupons` | List coupons |
| GET | `/admin/report` | Sales and coupon summary |

📖 Full reference with request/response examples and every error code: [docs/API.md](docs/API.md)
🧪 Postman collection: [postman/uniblox.postman_collection.json](postman/uniblox.postman_collection.json)

## What keeps it correct

- **No overselling:** stock is reduced with a single conditional update, and a database `CHECK` refuses negative stock.
- **Safe retries:** checking out the same cart again returns the original order instead of charging twice.
- **One redemption per coupon:** redeemed inside the checkout transaction, so a failed checkout gives the coupon back.
- **Orders explain themselves:** each order keeps its own copy of names, prices and totals.
- **Exact money:** everything is integer cents, and discounts round down, so totals never go negative.

The reasoning, trade-offs and what was deferred are in [DECISIONS.md](DECISIONS.md).

## Project layout

```
src/
  modules/
    products/   carts/   orders/   coupons/   reports/
      *.routes.ts    HTTP: validate input, call the service
      *.service.ts   business rules and database access
  app.ts  config.ts  db.ts  errors.ts  index.ts
prisma/          schema, migrations, seed
tests/           API tests against a real database
docs/API.md      endpoint reference
```

## Scripts

| Command | |
|---------|-|
| `npm run dev` | Start with auto-restart |
| `npm run build` · `npm start` | Compile and run |
| `npm test` | Run tests |
| `npm run db:seed` | Reset seed products' price and stock |
| `npm run db:reset` | Wipe the local DB, re-migrate, re-seed |
