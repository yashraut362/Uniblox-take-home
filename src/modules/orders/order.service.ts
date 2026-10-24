import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { findOpenCart, insufficientStockError, toCartView } from "../carts/cart.service.js";
import { redeemCoupon } from "../coupons/coupon.service.js";

const withItems = {
  items: { orderBy: { productId: "asc" } },
  coupon: { select: { code: true, percent: true } },
} satisfies Prisma.OrderInclude;

export async function checkout(cartId: string, couponCode?: string) {
  return prisma.$transaction(async (tx) => {
    const cart = toCartView(await findOpenCart(cartId, tx));
    if (cart.items.length === 0) throw new AppError(409, "CART_EMPTY", `Cart ${cartId} has no items`);

    const shortages = cart.items
      .filter((item) => !item.inStock)
      .map((item) => ({ productId: item.productId, available: item.availableStock, requested: item.quantity }));
    if (shortages.length > 0) throw insufficientStockError(shortages);

    const { couponId, discountCents } = couponCode
      ? await redeemCoupon(couponCode, cart.subtotalCents, tx)
      : { couponId: null, discountCents: 0 };

    for (const item of cart.items) {
      await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
    }

    await tx.cart.update({ where: { id: cartId }, data: { status: "CHECKED_OUT" } });

    return tx.order.create({
      data: {
        cartId,
        couponId,
        subtotalCents: cart.subtotalCents,
        discountCents,
        totalCents: cart.subtotalCents - discountCents,
        items: {
          create: cart.items.map((item) => ({
            productId: item.productId,
            productName: item.name,
            unitPriceCents: item.unitPriceCents,
            quantity: item.quantity,
            lineTotalCents: item.lineTotalCents,
          })),
        },
      },
      include: withItems,
    });
  });
}

export async function getOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: withItems });
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", `Order ${orderId} not found`);
  return order;
}
