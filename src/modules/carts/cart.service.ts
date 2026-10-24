import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import type { Prisma, Product } from "../../generated/prisma/client.js";
import { getProduct } from "../products/product.service.js";

const withItems = {
  items: { include: { product: true }, orderBy: { productId: "asc" } },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof withItems }>;

export function toCartView(cart: CartWithItems) {
  const items = cart.items.map(({ product, quantity }) => ({
    productId: product.id,
    name: product.name,
    unitPriceCents: product.priceCents,
    quantity,
    lineTotalCents: product.priceCents * quantity,
    availableStock: product.stock,
    inStock: quantity <= product.stock,
  }));

  return {
    id: cart.id,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

function assertInStock(product: Product, quantity: number) {
  if (quantity > product.stock) {
    throw new AppError(409, "INSUFFICIENT_STOCK", `Only ${product.stock} of product ${product.id} available`, {
      productId: product.id,
      available: product.stock,
      requested: quantity,
    });
  }
}

async function findCart(cartId: string) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: withItems });
  if (!cart) throw new AppError(404, "CART_NOT_FOUND", `Cart ${cartId} not found`);
  return cart;
}

async function findCartItem(cartId: string, productId: number) {
  const cart = await findCart(cartId);
  const item = cart.items.find((item) => item.productId === productId);
  if (!item) throw new AppError(404, "CART_ITEM_NOT_FOUND", `Product ${productId} is not in cart ${cartId}`);
  return item;
}

export async function createCart() {
  const cart = await prisma.cart.create({ data: {}, include: withItems });
  return toCartView(cart);
}

export async function getCart(cartId: string) {
  return toCartView(await findCart(cartId));
}

export async function addItem(cartId: string, productId: number, quantity: number) {
  const cart = await findCart(cartId);
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
  const item = await findCartItem(cartId, productId);
  assertInStock(item.product, quantity);

  await prisma.cartItem.update({ where: { cartId_productId: { cartId, productId } }, data: { quantity } });
  return getCart(cartId);
}

export async function removeItem(cartId: string, productId: number) {
  await findCartItem(cartId, productId);

  await prisma.cartItem.delete({ where: { cartId_productId: { cartId, productId } } });
  return getCart(cartId);
}
