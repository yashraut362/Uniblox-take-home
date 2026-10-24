# Decisions

**Time spent:** about 4.5 hours

Everything the brief requires is implemented and tested. What I deliberately left out is listed under [Implemented vs deferred](#implemented-vs-deferred).

## System invariants

These are the rules that must hold no matter how requests are retried or interleaved, and where each one is enforced.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| 1 | Stock never goes below zero, and units sold + remaining stock = starting stock | Conditional decrement `stock = stock - q WHERE stock >= q` in `order.service.ts`; `CHECK (stock >= 0)` on `Product` as a backstop |
| 2 | A cart produces at most one order | Cart row lock (`SELECT … FOR UPDATE`) + "return the existing order"; unique `Order.cartId` |
| 3 | A cart is checked out exactly when an order exists for it, and a checked-out cart's items equal its order's items | Status is derived from the order (no status column); cart edits take the same cart lock as checkout and refuse once an order exists |
| 4 | An order never changes after it's placed and explains its own total | `OrderItem` copies name, unit price, quantity and line total; the order stores subtotal, discount, total and its coupon |
| 5 | `lineTotal = unitPrice × quantity`, `subtotal = Σ lineTotal`, `total = subtotal − discount`, `0 ≤ discount ≤ subtotal` | Integer arithmetic in `toCartView` and `checkout`; `floor` rounding with percent limited to 1–100 |
| 6 | A coupon is redeemed by at most one order | Conditional `UPDATE … WHERE status = 'AVAILABLE'` inside the checkout transaction; unique `Order.couponId` |
| 7 | At most one coupon per milestone, and only once that milestone's order count is reached | Unique `Coupon.milestone`; eligibility check in `generateCoupon` |
| 8 | A failed checkout changes nothing: no stock taken, no coupon used, no order, cart still open | Everything happens in one transaction, and any error rolls it all back |
| 9 | The report agrees with the orders and coupons, and reading it changes nothing | Read-only queries in one repeatable-read transaction |

## Ambiguities and the semantics I chose

| Question the brief leaves open | My choice |
|--------------------------------|-----------|
| Price changes after an item is added | The cart always shows the **live** price; checkout charges the price at the moment of checkout, and the order records it. |
| Stock drops after an item is added | The cart shows `inStock: false`. Checkout **rejects the whole cart** with `409` and lists every short item. Nothing is silently removed. |
| Who gets the coupon? | Nobody in particular: there are no users, so a coupon is a **bearer code**. The admin generates it and hands it out; anyone holding it can use it once. |
| When is a coupon generated? | Only when the admin asks (`POST /admin/coupons`), as the brief says. Checkout never creates coupons. |
| Admin is late and several milestones have passed | **One coupon per call, oldest milestone first.** Calling again catches up. |
| Do orders that used a coupon count toward the next milestone? | **Yes.** They're successfully placed orders. |
| Can coupons stack? | **No.** One optional coupon per checkout. |
| Discount on the subtotal or per line? | **On the subtotal**, rounded once. |
| Coupon expiry | **None**, deferred. |
| `COUPON_PERCENT` changes later | Each coupon keeps the percent it was created with. |
| `COUPON_EVERY_N_ORDERS` changes later | The next milestone is the last rewarded milestone + the new n. |
| A coupon on a tiny cart rounds the discount to 0 | **Allowed.** The coupon is used up; the rule stays simple and deterministic. |
| Retried checkout sends a different coupon | The original order is returned unchanged; the body is ignored. |
| Retried "add item" | Adds again (it's an increment). `PATCH` sets an absolute quantity and is safe to retry. The cart is visible before paying, so the client can correct it. |
| Payment | Successful checkout counts as payment success (see Decision 8). |

## Material decisions

### Decision 1: Postgres row locks and conditional updates for concurrency

- **Options:** in-process mutex; `SERIALIZABLE` + retries; optimistic version columns; row locks + conditional updates.
- **Choice:** `SELECT … FOR UPDATE` on the cart, and `UPDATE … WHERE stock >= q` / `WHERE status = 'AVAILABLE'`.
- **Why:** my first, naive checkout let 10 concurrent orders take 3 desk mats, leaving stock at -7. With a conditional update, the check and the write happen in one statement, and the database holds the locks, so it also works across app instances.
- **Consequences:** checkouts of one product queue on its row; locks must always be taken in the same order.

### Decision 2: The cart ID is the idempotency key

- **Options:** an `Idempotency-Key` header with a stored response; the cart itself, since a cart becomes at most one order.
- **Choice:** the cart. If it already has an order, return that order with `200` instead of `201`.
- **Why:** no extra table, no key expiry, nothing for the client to forget.
- **Consequences:** only checkout is idempotent; a retry with a different body still gets the original order.

### Decision 3: Live prices in the cart, frozen prices in the order

- **Options:** lock the price when added; price live; price live and require the client to confirm the total.
- **Choice:** the cart is priced live; checkout copies name, price, quantity and line total into the order.
- **Why:** one source of truth until purchase, and the order still explains itself after the product changes.
- **Consequences:** a customer could pay a price they didn't see; a total-confirmation check is deferred.

### Decision 4: Reject the whole checkout if any item is short

- **Options:** silently drop short items; partially fill the order; reject the whole checkout.
- **Choice:** `409 INSUFFICIENT_STOCK` listing every short item; nothing is charged and the cart stays open.
- **Why:** the customer never pays for a different basket than the one they approved.
- **Consequences:** clients handle one more error, but can fix every shortage in one go.

### Decision 5: Coupons are bearer codes, one per milestone, generated on admin request

- **Options:** auto-generate on the n-th checkout; tie the coupon to that customer; admin generates on demand.
- **Choice:** `POST /admin/coupons` creates the oldest unrewarded milestone's coupon; `milestone` is unique; codes are random.
- **Why:** matches the brief, keeps checkout simple, and the unique milestone makes "only once" a database rule.
- **Consequences:** no expiry or per-customer limits; anyone holding the code can use it once.

### Decision 6: Redeem the coupon inside the checkout transaction

- **Options:** redeem after the order is created; reserve with a timeout; conditional update inside the same transaction.
- **Choice:** `UPDATE … SET status = 'REDEEMED' WHERE status = 'AVAILABLE'` inside checkout.
- **Why:** any later failure rolls the redemption back automatically, and a concurrent second checkout sees it's taken.
- **Consequences:** checkouts racing for one coupon run one after another, which is fine since only one can win.

### Decision 7: Integer cents, discount rounded down once

- **Options:** `Decimal` or integer cents; round half up, banker's or down; per line or on the subtotal.
- **Choice:** integer cents; `floor(subtotal × percent / 100)` once; percent limited to 1–100.
- **Why:** integer math never rounds, one rounding has no drift, and the discount can't exceed the subtotal.
- **Consequences:** amounts are capped by Postgres `INTEGER` (~21 million per order); production would use `BIGINT`.

### Decision 8: No payment step; a successful checkout is payment success

- **Options:** a fake gateway inside or outside the transaction; no payment step.
- **Choice:** no payment step.
- **Why:** a fake gateway adds failure paths and state without exercising anything real.
- **Consequences:** real payments would need a pending → paid order state and releasing stock and coupon on failure.

### Decision 9: Derive cart status from the order

- **Options:** keep the column; derive status from whether an order exists.
- **Choice:** removed the column; a cart is `CHECKED_OUT` exactly when an order references it.
- **Why:** one source of truth can't drift out of sync.
- **Consequences:** every cart read joins the order, which is one indexed lookup.

## Transactions, concurrency and idempotency

| Operation | Transaction | Locks taken, in order | Retry behavior |
|-----------|-------------|-----------------------|----------------|
| Checkout | Yes, `READ COMMITTED` | Cart row (`FOR UPDATE`) → coupon row (conditional update) → product rows in product-ID order (conditional updates) | Same cart again → `200` with the original order |
| Add / update / remove item | Yes | Cart row (`FOR UPDATE`) | Update is safe to repeat; a repeated remove returns `404`; add increments |
| Generate coupon | No (single insert) | Unique index on `milestone` | Duplicate → `409 COUPON_ALREADY_GENERATED`; call again |
| Report | Yes, `REPEATABLE READ`, read-only | None | Same result every time; no writes |

The order of locks is the same everywhere, so checkouts can't deadlock each other. Cart edits share the checkout lock, so an edit arriving mid-checkout waits, then gets `409 CART_ALREADY_CHECKED_OUT`. I found that gap while hunting edge cases; before the fix, an edit during checkout left the cart showing items that weren't in the order.

## Money and rounding

- All amounts are integer cents in the database, the code and the API. Field names end in `Cents`.
- `lineTotalCents = unitPriceCents × quantity`; `subtotalCents = Σ lineTotalCents`.
- `discountCents = floor(subtotalCents × percent / 100)`, computed once, on the subtotal.
- `totalCents = subtotalCents − discountCents`, which is always ≥ 0, since percent is 1–100.
- The report's `grossRevenueCents` is the sum of subtotals and `netRevenueCents` the sum of totals, so gross − discounts = net exactly.

## Error model

Every error has the same shape: `{ "error": { "code", "message", "details?" } }`. `code` is stable and meant for clients to branch on, `message` is for humans, and `details` carries structured data where it helps.

| Status | When | Codes | Why this status |
|--------|------|-------|-----------------|
| `400` | The request is malformed, whatever the current state | `VALIDATION_ERROR` (`details` lists each bad field), `INVALID_JSON` | Retrying the same request can never succeed; the client must fix it |
| `404` | Something referenced doesn't exist, including a product or coupon named in the body | `PRODUCT_NOT_FOUND`, `CART_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND`, `COUPON_NOT_FOUND`, `ROUTE_NOT_FOUND` | The request is well-formed, but points at nothing |
| `409` | The request is valid, but the current state prevents it | `INSUFFICIENT_STOCK` (`details`: `productId`, `available`, `requested`), `CART_ALREADY_CHECKED_OUT`, `CART_EMPTY`, `COUPON_ALREADY_REDEEMED`, `COUPON_NOT_ELIGIBLE` (`details`: `orderCount`, `nextMilestone`), `COUPON_ALREADY_GENERATED` | It could succeed after the state changes, e.g. after fixing the cart or placing more orders. I chose `409` over `422` so that every "state prevents this" error is in one class |
| `500` | An unexpected bug | `INTERNAL_ERROR` | Never used for business rules; internal details aren't exposed |

Checkout also uses success codes to carry meaning: `201` means this request created the order, and `200` means the cart was already checked out and the original order is being returned.

## Implemented vs deferred

**Implemented:**

- Every endpoint and rule in the brief.
- `GET /admin/coupons`, so the report can be reconciled against real coupon records.
- The safeguards above, and a database `CHECK` on stock.
- 15 tests against real Postgres (14 through the HTTP API, 1 unit test of the rounding). 7 of them are concurrency or retry scenarios.
- A Postman collection and an API reference with real example responses.

**Deliberately deferred:**

- **Authentication and authorization:** not required; `/admin/*` is where an auth check would go.
- **Coupon expiry and per-customer limits:** there are no users yet to tie coupons to.
- **Real payment flow:** a successful checkout counts as payment success.
- **Product management, restocking, pagination:** not required by the brief; products come from the seed.

## Evolving for multiple instances and production

- **Real users:** carts and coupons get owners, admin endpoints get authentication, and checkout and coupon redemption get rate limits.
- **Payment** moves outside the stock transaction, with a pending → paid state machine.
- **Reads:** serve the report and product listings from a read replica, or keep counters updated by the checkout transaction if the report becomes expensive.
- **Multiple app instances already work.** The app holds no state, and every lock and constraint lives in Postgres, so running several instances behind a load balancer needs no code changes.

## How I used AI

I used Claude Code as a pair programmer throughout. I drove the scope and order of work: CRUD first, then features one at a time, then edge cases, then tests. I asked for every change to be verified against a running server or the test suite before moving on, and I read and edited the code myself.

Things I used it for:

1. **Writing docs:** typing out the README, API reference, `DECISIONS.md` and tests is a lot of text, so I gave it a short idea of what each should say and had it write the full version, then reviewed and trimmed it.
2. **Brainstorming:** breaking the assignment into steps, and talking through open questions such as coupon semantics and what happens when prices change before checkout.
3. **Finding edge cases I missed:** for example, cart edits that arrived during a checkout left the cart showing items that weren't in the order, and concurrent removes of one item returned `500`. Both were reproduced first, then fixed by making cart edits take the same lock as checkout.
4. **Writing tests:** I described the scenarios (competing checkouts, retries, two checkouts racing for one coupon) and had it generate tests from them. I then had each safeguard broken on purpose to confirm a test fails for each.
5. **Architecture:** its first structure had separate `routes/`, `services/`, `models/` and `schemas/` folders. I found it hard to follow, so I rejected the `schemas/` folder and redirected it to feature modules with only routes and a service, and no repository layer. That also kept checkout's transaction readable in one function.

## If I had two more hours

1. **Contention under load:** measure checkout latency with hundreds of concurrent requests for the same product, since every checkout of that product waits on one stock row. Set lock and transaction timeouts, and return a retryable `503` instead of a `500` when Prisma's transaction timeout is hit.
2. **Tooling:** generate an OpenAPI spec from the zod schemas, type-check the test files, and add CI that runs the test suite against Postgres on every push.
