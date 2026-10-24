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
- `npm run db:reset` — wipe the local DB, re-apply all migrations, re-seed (dev only, deletes all data)
- `npm run db:studio` — browse data

## API

Import `postman/uniblox.postman_collection.json` into Postman. Run "List products" first (it saves product IDs), then "Create cart" (it saves the cart ID). All IDs are UUIDs.

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
| POST | `/carts/:cartId/checkout` `{ couponCode? }` | 201, the new order; 200, the existing order if this cart was already checked out |
| GET | `/orders/:orderId` | 200 |
| POST | `/admin/coupons` (admin) | 201, the new coupon |
| GET | `/admin/report` (admin) | 200, the sales and coupon summary |

Cart responses are priced live from current product data: each item has `unitPriceCents`, `lineTotalCents`, `availableStock` and `inStock`, and the cart has `status` (`OPEN`, or `CHECKED_OUT` once an order exists for it), `orderId` (`null` until checkout), `itemCount` (total quantity) and `subtotalCents`. All money is in integer cents.

Checkout runs in one transaction: it reduces stock, rejects the whole checkout if any item is short (listing every short item), and creates the order. A cart is checked out exactly when an order exists for it; there's no separate status column to keep in sync. The order stores its own copy of each item's name, unit price, quantity and line total, so it doesn't change if the product does. A checked-out cart can be viewed but not edited.

Checkout is safe to retry and safe under concurrency:
- It locks the cart row (`SELECT … FOR UPDATE`) first. Cart edits (add, update, remove) take the same lock, so checkouts and edits of one cart run one at a time: an edit that arrives during checkout waits, then gets `409 CART_ALREADY_CHECKED_OUT`, and the checked-out cart always matches its order. If the cart already has an order, that order is returned with `200` and nothing else happens (the request body is ignored).
- Stock is reduced with a conditional update (`stock = stock - q WHERE stock >= q`). If no row matches, the whole transaction rolls back with `409 INSUFFICIENT_STOCK`, so concurrent checkouts can't oversell. Items are processed in product-ID order, so two checkouts always lock products in the same order and can't deadlock.
- A `CHECK (stock >= 0)` constraint on `Product` is a last line of defence in the database.

Coupons are configured with `COUPON_EVERY_N_ORDERS` (n) and `COUPON_PERCENT` (x) in `.env`. Each n placed orders unlock one milestone (n, 2n, 3n…). `POST /admin/coupons` creates one coupon for the oldest milestone that has been reached and has no coupon yet; call it again to catch up on later milestones. A coupon is a single-use code anyone can redeem, worth the percent it was created with. Codes are case-insensitive and surrounding spaces are ignored. The discount is `floor(subtotal × percent / 100)` in cents, so the total never goes below 0. On a very small subtotal the discount can round to 0; the coupon is still accepted and used up. The coupon is redeemed inside the checkout transaction with a conditional update (`WHERE status = 'AVAILABLE'`), so two concurrent checkouts can't both use it, and a checkout that fails afterwards rolls the redemption back.

The report returns `totalOrders`, `productsSold` (quantity per product, including products with 0 sold), `grossRevenueCents` (sum of order subtotals), `totalDiscountCents`, `netRevenueCents` (sum of order totals, so gross − discounts) and coupon counts (`generated`, `available`, `redeemed`). It only reads, and runs all its queries in one repeatable-read transaction so the numbers reconcile even while orders are being placed.

Routes under `/admin` are administrative. There's no authentication.

Errors always look like `{ "error": { "code", "message", "details?" } }`:

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Bad body or path params, e.g. an ID that isn't a UUID (`details` lists each field) |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 404 | `PRODUCT_NOT_FOUND`, `CART_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND`, `COUPON_NOT_FOUND`, `ROUTE_NOT_FOUND` | Resource doesn't exist |
| 409 | `INSUFFICIENT_STOCK` | Requested quantity exceeds current stock (`details` lists each short product) |
| 409 | `CART_ALREADY_CHECKED_OUT` | Editing or checking out a cart that was already checked out |
| 409 | `CART_EMPTY` | Checking out a cart with no items |
| 409 | `COUPON_ALREADY_REDEEMED` | Coupon was already used by another order |
| 409 | `COUPON_NOT_ELIGIBLE` | No unrewarded milestone reached yet (`details` has `orderCount` and `nextMilestone`) |
| 409 | `COUPON_ALREADY_GENERATED` | Another request generated the coupon for the same milestone at the same moment; call again |
| 500 | `INTERNAL_ERROR` | Unexpected failure |
