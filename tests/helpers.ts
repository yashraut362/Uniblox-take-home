import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db.js";

export const api = () => request(app);

export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes("/uniblox_test")) throw new Error("Refusing to reset a non-test database");
  await prisma.$executeRaw`TRUNCATE "OrderItem", "Order", "Coupon", "CartItem", "Cart", "Product" CASCADE`;

  const keyboard = await prisma.product.create({ data: { name: "Keyboard", priceCents: 8999, stock: 50 } });
  const mouse = await prisma.product.create({ data: { name: "Mouse", priceCents: 2499, stock: 100 } });
  const deskMat = await prisma.product.create({ data: { name: "Desk Mat", priceCents: 1999, stock: 3 } });
  return { keyboard: keyboard.id, mouse: mouse.id, deskMat: deskMat.id };
}

export async function cartWith(...items: [productId: string, quantity: number][]) {
  const { body: cart } = await api().post("/carts").expect(201);
  for (const [productId, quantity] of items) {
    await api().post(`/carts/${cart.id}/items`).send({ productId, quantity }).expect(200);
  }
  return cart.id as string;
}

export async function placeOrders(count: number, productId: string) {
  const orderIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const { body } = await api().post(`/carts/${await cartWith([productId, 1])}/checkout`).expect(201);
    orderIds.push(body.id);
  }
  return orderIds;
}

export async function stockOf(productId: string) {
  const { stock } = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  return stock;
}

export function holdProductRow(productId: string, setStockTo?: number) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => (markLocked = resolve));

  const done = prisma.$transaction(
    async (tx) => {
      if (setStockTo === undefined) {
        await tx.$queryRaw`SELECT 1 FROM "Product" WHERE id = ${productId}::uuid FOR UPDATE`;
      } else {
        await tx.product.update({ where: { id: productId }, data: { stock: setStockTo } });
      }
      markLocked();
      await released;
    },
    { timeout: 15_000 },
  );

  return {
    locked,
    release: async () => {
      release();
      await done;
    },
  };
}

export async function waitForLockWaiters(count: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${count} queries to be waiting on a lock`);
}
