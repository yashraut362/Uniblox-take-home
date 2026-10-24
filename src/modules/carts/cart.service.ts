import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import type { Prisma, Product } from "../../generated/prisma/client.js";
import { getProduct } from "../products/product.service.js";

const withItems = {
  items: { include: { product: true }, orderBy: { productId: "asc" } },
  order: { select: { id: true } },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof withItems }>;

type StockShortage = { productId: string; available: number; requested: number };

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
    status: cart.order ? "CHECKED_OUT" : "OPEN",
    orderId: cart.order?.id ?? null,
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

function findItem(cart: CartWithItems, productId: string) {
  const item = cart.items.find((item) => item.productId === productId);
  if (!item) throw new AppError(404, "CART_ITEM_NOT_FOUND", `Product ${productId} is not in cart ${cart.id}`);
  return item;
}

async function findCart(cartId: string, db: Prisma.TransactionClient = prisma) {
  const cart = await db.cart.findUnique({ where: { id: cartId }, include: withItems });
  if (!cart) throw new AppError(404, "CART_NOT_FOUND", `Cart ${cartId} not found`);
  return cart;
}

export async function lockCart(cartId: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 FROM "Cart" WHERE id = ${cartId}::uuid FOR UPDATE`;
  return findCart(cartId, tx);
}

export async function createCart() {
  const cart = await prisma.cart.create({ data: {}, include: withItems });
  return toCartView(cart);
}

export async function getCart(cartId: string) {
  return toCartView(await findCart(cartId));
}

export async function addItem(cartId: string, productId: string, quantity: number) {
  await prisma.$transaction(async (tx) => {
    const cart = await lockCart(cartId, tx);
    if (cart.order) throw new AppError(409, "CART_ALREADY_CHECKED_OUT", `Cart ${cartId} has already been checked out`);
    const product = await getProduct(productId, tx);
    const existing = cart.items.find((item) => item.productId === productId);
    assertInStock(product, (existing?.quantity ?? 0) + quantity);

    await tx.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      create: { cartId, productId, quantity },
      update: { quantity: { increment: quantity } },
    });
  });
  return getCart(cartId);
}

export async function updateItemQuantity(cartId: string, productId: string, quantity: number) {
  await prisma.$transaction(async (tx) => {
    const cart = await lockCart(cartId, tx);
    if (cart.order) throw new AppError(409, "CART_ALREADY_CHECKED_OUT", `Cart ${cartId} has already been checked out`);
    assertInStock(findItem(cart, productId).product, quantity);

    await tx.cartItem.update({ where: { cartId_productId: { cartId, productId } }, data: { quantity } });
  });
  return getCart(cartId);
}

export async function removeItem(cartId: string, productId: string) {
  await prisma.$transaction(async (tx) => {
    const cart = await lockCart(cartId, tx);
    if (cart.order) throw new AppError(409, "CART_ALREADY_CHECKED_OUT", `Cart ${cartId} has already been checked out`);
    findItem(cart, productId);

    await tx.cartItem.delete({ where: { cartId_productId: { cartId, productId } } });
  });
  return getCart(cartId);
}
