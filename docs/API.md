# API reference

[`postman/uniblox.postman_collection.json`](../postman/uniblox.postman_collection.json) has every request below. Run "List products" first (it saves product IDs), then "Create cart" (it saves the cart ID).

## Conventions

- **IDs** are UUIDs. A malformed ID is `400 VALIDATION_ERROR`; a well-formed but unknown one is `404`.
- **Money** is always integer cents (`8999` = 89.99). Fields end in `Cents`.
- **Errors** always look like `{ "error": { "code", "message", "details?" } }`. Branch on `code`; `message` is for humans.
- **Admin** operations are the `/admin/*` routes. There's no authentication.
- Every endpoint can also return `500 INTERNAL_ERROR` for unexpected failures, and an unknown route is `404 ROUTE_NOT_FOUND`.

## Summary

| Method | Path | Success |
|--------|------|---------|
| GET | `/health` | 200 |
| GET | `/products` | 200 |
| GET | `/products/:productId` | 200 |
| POST | `/carts` | 201 |
| GET | `/carts/:cartId` | 200 |
| POST | `/carts/:cartId/items` | 200 |
| PATCH | `/carts/:cartId/items/:productId` | 200 |
| DELETE | `/carts/:cartId/items/:productId` | 200 |
| POST | `/carts/:cartId/checkout` | 201 new order, 200 existing order |
| GET | `/orders/:orderId` | 200 |
| POST | `/admin/coupons` | 201 |
| GET | `/admin/coupons` | 200 |
| GET | `/admin/report` | 200 |

## Products

**`GET /products`** returns all products, sorted by name. **`GET /products/:productId`** returns one:

```json
{
  "id": "d00625e0-195c-41c4-ba42-41a22401b12b",
  "name": "Mechanical Keyboard",
  "priceCents": 8999,
  "stock": 50,
  "createdAt": "2026-10-24T10:31:41.990Z",
  "updatedAt": "2026-10-24T10:31:41.990Z"
}
```

Errors: `400 VALIDATION_ERROR` (ID not a UUID), `404 PRODUCT_NOT_FOUND`.

## Carts

All cart endpoints return the cart, priced live from current product data:

```json
{
  "id": "3f53577d-35b5-4626-9516-86fc13e44d0e",
  "status": "OPEN",
  "orderId": null,
  "items": [
    {
      "productId": "d00625e0-195c-41c4-ba42-41a22401b12b",
      "name": "Mechanical Keyboard",
      "unitPriceCents": 8999,
      "quantity": 2,
      "lineTotalCents": 17998,
      "availableStock": 50,
      "inStock": true
    }
  ],
  "itemCount": 2,
  "subtotalCents": 17998,
  "createdAt": "2026-10-24T10:31:42.787Z",
  "updatedAt": "2026-10-24T10:31:42.787Z"
}
```

`status` is `CHECKED_OUT` once an order exists for the cart, and `orderId` then points to it. `itemCount` is the total quantity. `inStock` is `false` if stock dropped below the cart's quantity after the item was added; checkout would then be rejected.

| Request | Body | Success | Errors |
|---------|------|---------|--------|
| `POST /carts` | none | `201`, an empty cart | — |
| `GET /carts/:cartId` | none | `200` | `400 VALIDATION_ERROR`, `404 CART_NOT_FOUND` |
| `POST /carts/:cartId/items` | `{ "productId": "<uuid>", "quantity": 2 }` | `200`. If the product is already in the cart, the quantity is **added** to it. | `400 VALIDATION_ERROR` (quantity not a positive integer, bad ID), `404 CART_NOT_FOUND`, `404 PRODUCT_NOT_FOUND`, `409 INSUFFICIENT_STOCK` (new total exceeds stock), `409 CART_ALREADY_CHECKED_OUT` |
| `PATCH /carts/:cartId/items/:productId` | `{ "quantity": 5 }` | `200`. Sets the exact quantity. | `400 VALIDATION_ERROR`, `404 CART_NOT_FOUND`, `404 CART_ITEM_NOT_FOUND`, `409 INSUFFICIENT_STOCK`, `409 CART_ALREADY_CHECKED_OUT` |
| `DELETE /carts/:cartId/items/:productId` | none | `200` | `400 VALIDATION_ERROR`, `404 CART_NOT_FOUND`, `404 CART_ITEM_NOT_FOUND`, `409 CART_ALREADY_CHECKED_OUT` |

`INSUFFICIENT_STOCK` lists the short product: `"details": [{ "productId": "…", "available": 3, "requested": 4 }]`.

Retrying `POST …/items` adds the quantity again, because "add" increments. That's deliberate: the cart is visible and fixable before paying, and a client that needs a retry-safe update should use `PATCH`, which sets an absolute quantity. Checkout, which charges stock and coupons, is the operation made retry-safe.

## Checkout and orders

**`POST /carts/:cartId/checkout`**, with an optional body `{ "couponCode": "SAVE10-3A4DE03F" }`. The coupon code is case-insensitive and surrounding spaces are ignored.

- `201` with the new order.
- `200` with the **same order** if this cart was already checked out. This is how retries are made safe: the request body is ignored and nothing is charged again.

```json
{
  "id": "3801dcbc-5059-4e81-bc21-587f9269d2fe",
  "cartId": "3f53577d-35b5-4626-9516-86fc13e44d0e",
  "couponId": "fe2eabcb-d725-4d47-8bb8-c7d40d395683",
  "subtotalCents": 20497,
  "discountCents": 2049,
  "totalCents": 18448,
  "createdAt": "2026-10-24T10:31:42.866Z",
  "items": [
    {
      "orderId": "3801dcbc-5059-4e81-bc21-587f9269d2fe",
      "productId": "a35b8d28-1d94-4c58-b109-33e889b4bcf1",
      "productName": "Wireless Mouse",
      "unitPriceCents": 2499,
      "quantity": 1,
      "lineTotalCents": 2499
    },
    {
      "orderId": "3801dcbc-5059-4e81-bc21-587f9269d2fe",
      "productId": "d00625e0-195c-41c4-ba42-41a22401b12b",
      "productName": "Mechanical Keyboard",
      "unitPriceCents": 8999,
      "quantity": 2,
      "lineTotalCents": 17998
    }
  ],
  "coupon": { "code": "SAVE10-3A4DE03F", "percent": 10 }
}
```

`coupon` is `null` and `discountCents` is `0` without a coupon. The order keeps its own copy of each item's name, unit price, quantity and line total, so it still explains its total after the product changes.

Errors: `400 VALIDATION_ERROR` (bad ID, empty or non-string `couponCode`), `404 CART_NOT_FOUND`, `409 CART_EMPTY`, `409 INSUFFICIENT_STOCK` (lists **every** short item), `404 COUPON_NOT_FOUND`, `409 COUPON_ALREADY_REDEEMED`. Any error rolls back the whole checkout: no stock is taken and no coupon is used.

**`GET /orders/:orderId`** returns the same shape. Errors: `400 VALIDATION_ERROR`, `404 ORDER_NOT_FOUND`.

## Admin

**`POST /admin/coupons`** generates the coupon for the oldest milestone (n, 2n, 3n… placed orders) that has been reached and has no coupon yet. Call it again to catch up on later milestones.

```json
{
  "id": "fe2eabcb-d725-4d47-8bb8-c7d40d395683",
  "code": "SAVE10-3A4DE03F",
  "percent": 10,
  "milestone": 1,
  "status": "AVAILABLE",
  "createdAt": "2026-10-24T10:31:42.746Z",
  "redeemedAt": null
}
```

Errors: `409 COUPON_NOT_ELIGIBLE` with `"details": { "orderCount": 2, "nextMilestone": 3 }`; `409 COUPON_ALREADY_GENERATED` if a simultaneous request just created the coupon for the same milestone (call again).

**`GET /admin/coupons`** lists every coupon by milestone, with the order that redeemed it:

```json
[
  {
    "id": "fe2eabcb-d725-4d47-8bb8-c7d40d395683",
    "code": "SAVE10-3A4DE03F",
    "percent": 10,
    "milestone": 1,
    "status": "REDEEMED",
    "createdAt": "2026-10-24T10:31:42.746Z",
    "redeemedAt": "2026-10-24T10:31:42.863Z",
    "orderId": "3801dcbc-5059-4e81-bc21-587f9269d2fe"
  }
]
```

**`GET /admin/report`** returns the sales summary. It only reads, and runs all its queries in one repeatable-read transaction, so the numbers agree with each other even while orders are being placed.

```json
{
  "totalOrders": 2,
  "productsSold": [
    { "productId": "6d7c4f86-…", "name": "27-inch Monitor", "quantity": 0 },
    { "productId": "c9015353-…", "name": "Limited Edition Desk Mat", "quantity": 0 },
    { "productId": "d00625e0-…", "name": "Mechanical Keyboard", "quantity": 2 },
    { "productId": "c4eadcac-…", "name": "USB-C Hub", "quantity": 0 },
    { "productId": "a35b8d28-…", "name": "Wireless Mouse", "quantity": 2 }
  ],
  "grossRevenueCents": 22996,
  "totalDiscountCents": 2049,
  "netRevenueCents": 20947,
  "coupons": { "generated": 1, "available": 0, "redeemed": 1 }
}
```

`grossRevenueCents` is the sum of order subtotals, `netRevenueCents` the sum of order totals, so gross − discounts = net. `productsSold` includes products with 0 sold. Open carts aren't counted.

## Validation error example

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request is invalid",
    "details": [
      { "path": "productId", "message": "Invalid UUID" },
      { "path": "quantity", "message": "Too small: expected number to be >0" }
    ]
  }
}
```

## All error codes

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Bad body or path params (`details` lists each field) |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 404 | `PRODUCT_NOT_FOUND`, `CART_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND`, `COUPON_NOT_FOUND`, `ROUTE_NOT_FOUND` | Resource doesn't exist |
| 409 | `INSUFFICIENT_STOCK` | Requested quantity exceeds current stock (`details` lists each short product) |
| 409 | `CART_ALREADY_CHECKED_OUT` | Editing a cart that has an order |
| 409 | `CART_EMPTY` | Checking out a cart with no items |
| 409 | `COUPON_ALREADY_REDEEMED` | Coupon was already used by another order |
| 409 | `COUPON_NOT_ELIGIBLE` | No unrewarded milestone reached yet |
| 409 | `COUPON_ALREADY_GENERATED` | A simultaneous request generated this milestone's coupon; call again |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

