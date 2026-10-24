import { beforeEach, describe, expect, it } from "vitest";
import { api, cartWith, placeOrders, resetDb } from "./helpers.js";

let products: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => {
  products = await resetDb();
});

describe("admin report", () => {
  it("reconciles with the orders and coupons the API returns, and repeated reads change nothing", async () => {
    const orderIds = await placeOrders(6, products.mouse);
    await api().post("/admin/coupons").expect(201);
    const { body: unused } = await api().post("/admin/coupons").expect(201);
    const { body: discounted } = await api()
      .post(`/carts/${await cartWith([products.keyboard, 2], [products.deskMat, 1])}/checkout`)
      .send({ couponCode: (await api().get("/admin/coupons")).body[0].code })
      .expect(201);
    await cartWith([products.keyboard, 5]);

    const orders = await Promise.all(
      [...orderIds, discounted.id].map(async (id) => (await api().get(`/orders/${id}`).expect(200)).body),
    );
    const { body: coupons } = await api().get("/admin/coupons").expect(200);
    const sum = (field: string) => orders.reduce((total, order) => total + order[field], 0);
    const sold = (productId: string) =>
      orders.flatMap((order) => order.items).filter((item) => item.productId === productId).reduce((total, item) => total + item.quantity, 0);

    const first = await api().get("/admin/report").expect(200);
    const second = await api().get("/admin/report").expect(200);

    expect(second.body).toEqual(first.body);
    expect(first.body).toEqual({
      totalOrders: orders.length,
      productsSold: [
        { productId: products.deskMat, name: "Desk Mat", quantity: sold(products.deskMat) },
        { productId: products.keyboard, name: "Keyboard", quantity: sold(products.keyboard) },
        { productId: products.mouse, name: "Mouse", quantity: sold(products.mouse) },
      ],
      grossRevenueCents: sum("subtotalCents"),
      totalDiscountCents: sum("discountCents"),
      netRevenueCents: sum("totalCents"),
      coupons: {
        generated: coupons.length,
        available: coupons.filter((c: { status: string }) => c.status === "AVAILABLE").length,
        redeemed: coupons.filter((c: { status: string }) => c.status === "REDEEMED").length,
      },
    });

    expect(first.body).toMatchObject({ totalOrders: 7, totalDiscountCents: discounted.discountCents, coupons: { generated: 2, available: 1, redeemed: 1 } });
    expect(first.body.grossRevenueCents - first.body.totalDiscountCents).toBe(first.body.netRevenueCents);
    expect(coupons).toEqual([
      expect.objectContaining({ milestone: 3, status: "REDEEMED", orderId: discounted.id }),
      expect.objectContaining({ milestone: 6, status: "AVAILABLE", orderId: null, code: unused.code }),
    ]);
  });
});
