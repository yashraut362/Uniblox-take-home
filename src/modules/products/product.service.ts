import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import type { Prisma } from "../../generated/prisma/client.js";

export function listProducts() {
  return prisma.product.findMany({ orderBy: { name: "asc" } });
}

export async function getProduct(productId: string, db: Prisma.TransactionClient = prisma) {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", `Product ${productId} not found`);
  return product;
}
