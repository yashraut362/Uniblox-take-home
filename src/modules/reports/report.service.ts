import { prisma } from "../../db.js";

export async function getReport() {
  return prisma.$transaction(
    async (tx) => {
      const orders = await tx.order.aggregate({
        _count: true,
        _sum: { subtotalCents: true, discountCents: true, totalCents: true },
      });
      const sold = await tx.orderItem.groupBy({ by: ["productId"], _sum: { quantity: true } });
      const products = await tx.product.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
      const coupons = await tx.coupon.groupBy({ by: ["status"], _count: true });

      const quantityByProduct = new Map(sold.map((row) => [row.productId, row._sum.quantity ?? 0]));
      const couponCount = (status: string) => coupons.find((row) => row.status === status)?._count ?? 0;

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
          generated: couponCount("AVAILABLE") + couponCount("REDEEMED"),
          available: couponCount("AVAILABLE"),
          redeemed: couponCount("REDEEMED"),
        },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
