import { prisma } from "../../db.js";

export async function getReport() {
  return prisma.$transaction(
    async (tx) => {
      const orders = await tx.order.aggregate({
        _count: true,
        _sum: { subtotalCents: true, discountCents: true, totalCents: true },
      });
      const sold = await tx.orderItem.groupBy({ by: ["productId"], _sum: { quantity: true } });
      const products = await tx.product.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
      const availableCoupons = await tx.coupon.count({ where: { status: "AVAILABLE" } });
      const redeemedCoupons = await tx.coupon.count({ where: { status: "REDEEMED" } });

      const quantityByProduct = new Map(sold.map((row) => [row.productId, row._sum.quantity ?? 0]));

      return {
        totalOrders: orders._count,
        productsSold: products.map((product) => ({
          productId: product.id,
          name: product.name,
          quantity: quantityByProduct.get(product.id) ?? 0,
        })),
        grossRevenueCents: orders._sum.subtotalCents ?? 0,
        totalDiscountCents: orders._sum.discountCents ?? 0,
        netRevenueCents: orders._sum.totalCents ?? 0,
        coupons: {
          generated: availableCoupons + redeemedCoupons,
          available: availableCoupons,
          redeemed: redeemedCoupons,
        },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
