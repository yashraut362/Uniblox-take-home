import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import type { Prisma, Product } from "../../generated/prisma/client.js";
import { getProduct } from "../products/product.service.js";

const withItems = {
  items: { include: { product: true }, orderBy: { id: "asc" } },
} satisfies Prisma.CartInclude;

function assertInStock(product: Product, quantity: number) {
  if (quantity > product.stock) {
    throw new AppError(409, "INSUFFICIENT_STOCK", `Only ${product.stock} of product ${product.id} available`, {
      productId: product.id,
      available: product.stock,
      requested: quantity,
    });
  }
}

async function getCartItem(cartId: string, productId: number) {
  const cart = await getCart(cartId);
  const item = cart.items.find((item) => item.productId === productId);
  if (!item) throw new AppError(404, "CART_ITEM_NOT_FOUND", `Product ${productId} is not in cart ${cartId}`);
  return item;
}

export function createCart() {
  return prisma.cart.create({ data: {}, include: withItems });
}

export async function getCart(cartId: string) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: withItems });
  if (!cart) throw new AppError(404, "CART_NOT_FOUND", `Cart ${cartId} not found`);
  return cart;
}

export async function addItem(cartId: string, productId: number, quantity: number) {
  const cart = await getCart(cartId);
  const product = await getProduct(productId);
  const existing = cart.items.find((item) => item.productId === productId);
  assertInStock(product, (existing?.quantity ?? 0) + quantity);

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId, productId } },
    create: { cartId, productId, quantity },
    update: { quantity: { increment: quantity } },
  });
  return getCart(cartId);
}

export async function updateItemQuantity(cartId: string, productId: number, quantity: number) {
  const item = await getCartItem(cartId, productId);
  assertInStock(item.product, quantity);

  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return getCart(cartId);
}

export async function removeItem(cartId: string, productId: number) {
  const item = await getCartItem(cartId, productId);

  await prisma.cartItem.delete({ where: { id: item.id } });
  return getCart(cartId);
}
