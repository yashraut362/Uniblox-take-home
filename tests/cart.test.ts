import { beforeEach, describe, expect, it } from "vitest";
import { api, cartWith, resetDb } from "./helpers.js";

let products: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => {
  products = await resetDb();
});

describe("cart", () => {
  it("prices items live and keeps totals in integer cents", async () => {
    const cartId = await cartWith([products.keyboard, 2], [products.deskMat, 1]);
    const { body } = await api().post(`/carts/${cartId}/items`).send({ productId: products.keyboard, quantity: 1 }).expect(200);

    expect(body.items).toHaveLength(2);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: products.keyboard, quantity: 3, unitPriceCents: 8999, lineTotalCents: 26997 }),
        expect.objectContaining({ productId: products.deskMat, quantity: 1, unitPriceCents: 1999, lineTotalCents: 1999 }),
      ]),
    );
    expect(body).toMatchObject({ status: "OPEN", orderId: null, itemCount: 4, subtotalCents: 28996 });
  });

  it("rejects invalid items with distinguishable errors", async () => {
    const cartId = await cartWith();
    const add = (body: object) => api().post(`/carts/${cartId}/items`).send(body);

    expect((await add({ productId: products.keyboard, quantity: 0 })).body.error.code).toBe("VALIDATION_ERROR");
    expect((await add({ productId: products.keyboard, quantity: 1.5 })).body.error.code).toBe("VALIDATION_ERROR");
    expect((await add({ productId: "not-a-uuid", quantity: 1 })).status).toBe(400);
    expect((await add({ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 })).body.error.code).toBe("PRODUCT_NOT_FOUND");

    const overStock = await add({ productId: products.deskMat, quantity: 4 });
    expect(overStock.status).toBe(409);
    expect(overStock.body.error).toMatchObject({ code: "INSUFFICIENT_STOCK", details: [{ productId: products.deskMat, available: 3, requested: 4 }] });

    const { body } = await api().get(`/carts/${cartId}`).expect(200);
    expect(body.items).toEqual([]);
  });

  it("serializes concurrent edits of one item instead of failing", async () => {
    const cartId = await cartWith([products.keyboard, 1]);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => api().delete(`/carts/${cartId}/items/${products.keyboard}`)),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([200, 404, 404, 404, 404]);
  });
});
