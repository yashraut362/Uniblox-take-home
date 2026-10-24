import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";

export function listProducts() {
  return prisma.product.findMany({ orderBy: { id: "asc" } });
}

export async function getProduct(productId: number) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", `Product ${productId} not found`);
  return product;
}
