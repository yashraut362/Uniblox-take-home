import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { insufficientStockError, lockCart, toCartView } from "../carts/cart.service.js";
import { redeemCoupon } from "../coupons/coupon.service.js";

const withItems = {
  items: { orderBy: { productId: "asc" } },
  coupon: { select: { code: true, percent: true } },
} satisfies Prisma.OrderInclude;

export async function checkout(cartId: string, couponCode?: string) {
  return prisma.$transaction(async (tx) => {
    const lockedCart = await lockCart(cartId, tx);
    if (lockedCart.order) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: lockedCart.order.id }, include: withItems });
      return { order, created: false };
    }

    const cart = toCartView(lockedCart);
    if (cart.items.length === 0) throw new AppError(409, "CART_EMPTY", `Cart ${cartId} has no items`);

    const { couponId, discountCents } = couponCode
      ? await redeemCoupon(couponCode, cart.subtotalCents, tx)
      : { couponId: null, discountCents: 0 };

    const shortages = [];
    for (const item of cart.items) {
      const { count } = await tx.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (count === 0) {
        const { stock } = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
        shortages.push({ productId: item.productId, available: stock, requested: item.quantity });
      }
    }
    if (shortages.length > 0) throw insufficientStockError(shortages);

    const order = await tx.order.create({
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
    return { order, created: true };
  });
}

export async function getOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: withItems });
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", `Order ${orderId} not found`);
  return order;
}
