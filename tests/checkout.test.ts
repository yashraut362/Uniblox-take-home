import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { api, cartWith, holdProductRow, resetDb, stockOf, waitForLockWaiters } from "./helpers.js";

let products: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => {
  products = await resetDb();
});

describe("checkout", () => {
  it("creates an order that keeps its prices after the product changes", async () => {
    const cartId = await cartWith([products.keyboard, 2]);
    const { body: order } = await api().post(`/carts/${cartId}/checkout`).expect(201);

    await prisma.product.update({ where: { id: products.keyboard }, data: { priceCents: 9999, name: "Renamed" } });

    const { body } = await api().get(`/orders/${order.id}`).expect(200);
    expect(body).toMatchObject({ subtotalCents: 17998, discountCents: 0, totalCents: 17998 });
    expect(body.items).toEqual([
      expect.objectContaining({ productName: "Keyboard", unitPriceCents: 8999, quantity: 2, lineTotalCents: 17998 }),
    ]);
    expect(await stockOf(products.keyboard)).toBe(48);
  });

  it("rejects the whole checkout when any item is short, charging nothing", async () => {
    const cartId = await cartWith([products.keyboard, 2], [products.deskMat, 3]);
    await prisma.product.update({ where: { id: products.deskMat }, data: { stock: 1 } });

    const { status, body } = await api().post(`/carts/${cartId}/checkout`);

    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: "INSUFFICIENT_STOCK", details: [{ productId: products.deskMat, available: 1, requested: 3 }] });
    expect(await stockOf(products.keyboard)).toBe(50);
    expect((await api().get(`/carts/${cartId}`)).body.status).toBe("OPEN");
  });

  it("never oversells when checkouts compete for the last items", async () => {
    const cartIds = await Promise.all(Array.from({ length: 10 }, () => cartWith([products.deskMat, 1])));

    const responses = await Promise.all(cartIds.map((id) => api().post(`/carts/${id}/checkout`)));

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(responses.filter((r) => r.status === 409).every((r) => r.body.error.code === "INSUFFICIENT_STOCK")).toBe(true);
    expect(await stockOf(products.deskMat)).toBe(0);
    expect(await prisma.order.count()).toBe(3);
  });

  it("returns the original order to retries instead of charging twice", async () => {
    const cartId = await cartWith([products.keyboard, 1]);

    const concurrent = await Promise.all(Array.from({ length: 5 }, () => api().post(`/carts/${cartId}/checkout`)));
    const later = await api().post(`/carts/${cartId}/checkout`).send({ couponCode: "IGNORED" });

    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const orderIds = new Set([...concurrent, later].map((r) => r.body.id));
    expect(orderIds.size).toBe(1);
    expect(later.status).toBe(200);
    expect(await prisma.order.count()).toBe(1);
    expect(await stockOf(products.keyboard)).toBe(49);
  });

  it("blocks cart edits that arrive while checkout is running", async () => {
    const cartId = await cartWith([products.keyboard, 1]);
    const row = holdProductRow(products.keyboard);
    await row.locked;

    const checkout = api().post(`/carts/${cartId}/checkout`).then((r) => r);
    await waitForLockWaiters(1);
    const edit = api().patch(`/carts/${cartId}/items/${products.keyboard}`).send({ quantity: 5 }).then((r) => r);
    await waitForLockWaiters(2);
    await row.release();

    expect((await checkout).status).toBe(201);
    expect((await edit).body.error.code).toBe("CART_ALREADY_CHECKED_OUT");
    const { body: cart } = await api().get(`/carts/${cartId}`);
    const { body: order } = await api().get(`/orders/${cart.orderId}`);
    expect(cart.items[0].quantity).toBe(1);
    expect(order.items[0].quantity).toBe(1);
  });
});
