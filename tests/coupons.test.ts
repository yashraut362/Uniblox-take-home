import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { calculateDiscount } from "../src/modules/coupons/coupon.service.js";
import { api, cartWith, holdProductRow, placeOrders, resetDb, stockOf, waitForLockWaiters } from "./helpers.js";

let products: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => {
  products = await resetDb();
});

async function generateCoupon() {
  await placeOrders(3, products.mouse);
  const { body } = await api().post("/admin/coupons").expect(201);
  return body.code as string;
}

describe("coupons", () => {
  it("rounds discounts down to whole cents and never exceeds the subtotal", () => {
    expect(calculateDiscount(1999, 10)).toBe(199);
    expect(calculateDiscount(11498, 10)).toBe(1149);
    expect(calculateDiscount(1, 10)).toBe(0);
    expect(calculateDiscount(5000, 100)).toBe(5000);
  });

  it("generates one coupon per milestone, only after it is reached", async () => {
    await placeOrders(2, products.mouse);
    const early = await api().post("/admin/coupons");
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "COUPON_NOT_ELIGIBLE", details: { orderCount: 2, nextMilestone: 3 } });

    await placeOrders(1, products.mouse);
    const { body: coupon } = await api().post("/admin/coupons").expect(201);
    expect(coupon).toMatchObject({ milestone: 3, percent: 10, status: "AVAILABLE" });

    const again = await api().post("/admin/coupons");
    expect(again.body.error).toMatchObject({ code: "COUPON_NOT_ELIGIBLE", details: { nextMilestone: 6 } });
  });

  it("creates only one coupon when admins generate at the same time", async () => {
    await placeOrders(3, products.mouse);

    const responses = await Promise.all(Array.from({ length: 5 }, () => api().post("/admin/coupons")));

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.coupon.count()).toBe(1);
  });

  it("applies the discount once and rejects reuse", async () => {
    const code = await generateCoupon();
    const cartId = await cartWith([products.keyboard, 1], [products.mouse, 1]);

    const { body: order } = await api().post(`/carts/${cartId}/checkout`).send({ couponCode: ` ${code.toLowerCase()} ` }).expect(201);
    expect(order).toMatchObject({ subtotalCents: 11498, discountCents: 1149, totalCents: 10349, coupon: { code, percent: 10 } });

    const reuse = await api().post(`/carts/${await cartWith([products.keyboard, 1])}/checkout`).send({ couponCode: code });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe("COUPON_ALREADY_REDEEMED");
  });

  it("lets only one of several concurrent checkouts redeem a coupon", async () => {
    const code = await generateCoupon();
    const cartIds = await Promise.all(Array.from({ length: 5 }, () => cartWith([products.keyboard, 1])));

    const responses = await Promise.all(cartIds.map((id) => api().post(`/carts/${id}/checkout`).send({ couponCode: code })));

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.body.error?.code === "COUPON_ALREADY_REDEEMED")).toHaveLength(4);
    expect(await prisma.order.count({ where: { couponId: { not: null } } })).toBe(1);
    expect(await stockOf(products.keyboard)).toBe(49);
  });

  it("keeps the coupon available when checkout fails after redeeming it", async () => {
    const code = await generateCoupon();
    const cartId = await cartWith([products.deskMat, 3]);
    const row = holdProductRow(products.deskMat, 0);
    await row.locked;

    const checkout = api().post(`/carts/${cartId}/checkout`).send({ couponCode: code }).then((r) => r);
    await waitForLockWaiters(1);
    await row.release();

    const { status, body } = await checkout;
    expect(status).toBe(409);
    expect(body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await prisma.coupon.findUniqueOrThrow({ where: { code } })).toMatchObject({ status: "AVAILABLE", redeemedAt: null });
    expect(await prisma.order.count({ where: { cartId } })).toBe(0);
  });
});
