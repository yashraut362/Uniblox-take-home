import { randomBytes } from "node:crypto";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import type { Prisma } from "../../generated/prisma/client.js";

export function calculateDiscount(subtotalCents: number, percent: number) {
  return Math.floor((subtotalCents * percent) / 100);
}

export async function generateCoupon() {
  const orderCount = await prisma.order.count();
  const lastCoupon = await prisma.coupon.findFirst({ orderBy: { milestone: "desc" } });
  const milestone = (lastCoupon?.milestone ?? 0) + config.couponEveryNOrders;

  if (orderCount < milestone) {
    throw new AppError(409, "COUPON_NOT_ELIGIBLE", `Next coupon unlocks at ${milestone} orders; ${orderCount} placed so far`, {
      orderCount,
      nextMilestone: milestone,
    });
  }

  const code = `SAVE${config.couponPercent}-${randomBytes(4).toString("hex").toUpperCase()}`;
  return prisma.coupon.create({ data: { code, percent: config.couponPercent, milestone } });
}

export async function redeemCoupon(code: string, subtotalCents: number, tx: Prisma.TransactionClient) {
  const coupon = await tx.coupon.findUnique({ where: { code } });
  if (!coupon) throw new AppError(404, "COUPON_NOT_FOUND", `Coupon ${code} not found`);
  if (coupon.status !== "AVAILABLE") {
    throw new AppError(409, "COUPON_ALREADY_REDEEMED", `Coupon ${code} has already been redeemed`);
  }

  await tx.coupon.update({ where: { id: coupon.id }, data: { status: "REDEEMED", redeemedAt: new Date() } });
  return { couponId: coupon.id, discountCents: calculateDiscount(subtotalCents, coupon.percent) };
}
