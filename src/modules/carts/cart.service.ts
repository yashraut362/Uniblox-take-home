import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import type { Prisma, Product } from "../../generated/prisma/client.js";
import { getProduct } from "../products/product.service.js";

const withItems = {
  items: { include: { product: true }, orderBy: { productId: "asc" } },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof withItems }>;

type StockShortage = { productId: number; available: number; requested: number };

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
    status: cart.status,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

export function insufficientStockError(shortages: StockShortage[]) {
  const productIds = shortages.map((shortage) => shortage.productId).join(", ");
  return new AppError(409, "INSUFFICIENT_STOCK", `Not enough stock for product(s) ${productIds}`, shortages);
}

function assertInStock(product: Product, quantity: number) {
  if (quantity > product.stock) {
    throw insufficientStockError([{ productId: product.id, available: product.stock, requested: quantity }]);
  }
}

export async function findCart(cartId: string, db: Prisma.TransactionClient = prisma) {
  const cart = await db.cart.findUnique({ where: { id: cartId }, include: withItems });
  if (!cart) throw new AppError(404, "CART_NOT_FOUND", `Cart ${cartId} not found`);
  return cart;
}

export async function findOpenCart(cartId: string, db: Prisma.TransactionClient = prisma) {
  const cart = await findCart(cartId, db);
  if (cart.status !== "OPEN") {
    throw new AppError(409, "CART_ALREADY_CHECKED_OUT", `Cart ${cartId} has already been checked out`);
  }
  return cart;
}

async function findCartItem(cartId: string, productId: number) {
  const cart = await findOpenCart(cartId);
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
  const cart = await findOpenCart(cartId);
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
