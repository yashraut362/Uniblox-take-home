import { randomBytes } from "node:crypto";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import { Prisma } from "../../generated/prisma/client.js";

export function calculateDiscount(subtotalCents: number, percent: number) {
  return Math.floor((subtotalCents * percent) / 100);
}

export async function listCoupons() {
  const coupons = await prisma.coupon.findMany({ orderBy: { milestone: "asc" }, include: { order: { select: { id: true } } } });
  return coupons.map(({ order, ...coupon }) => ({ ...coupon, orderId: order?.id ?? null }));
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
  try {
    return await prisma.coupon.create({ data: { code, percent: config.couponPercent, milestone } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "COUPON_ALREADY_GENERATED", `Coupon for milestone ${milestone} was just generated; try again`);
    }
    throw err;
  }
}

export async function redeemCoupon(code: string, subtotalCents: number, tx: Prisma.TransactionClient) {
  const { count } = await tx.coupon.updateMany({
    where: { code, status: "AVAILABLE" },
    data: { status: "REDEEMED", redeemedAt: new Date() },
  });

  const coupon = await tx.coupon.findUnique({ where: { code } });
  if (!coupon) throw new AppError(404, "COUPON_NOT_FOUND", `Coupon ${code} not found`);
  if (count === 0) throw new AppError(409, "COUPON_ALREADY_REDEEMED", `Coupon ${code} has already been redeemed`);

  return { couponId: coupon.id, discountCents: calculateDiscount(subtotalCents, coupon.percent) };
}
