import "dotenv/config";
import { prisma } from "../src/db.js";

const products = [
  { name: "Mechanical Keyboard", priceCents: 8999, stock: 50 },
  { name: "Wireless Mouse", priceCents: 2499, stock: 100 },
  { name: "USB-C Hub", priceCents: 3999, stock: 40 },
  { name: "27-inch Monitor", priceCents: 24999, stock: 20 },
  { name: "Limited Edition Desk Mat", priceCents: 1999, stock: 3 },
];

for (const product of products) {
  await prisma.product.upsert({
    where: { name: product.name },
    update: { priceCents: product.priceCents, stock: product.stock },
    create: product,
  });
}

console.log(`Seeded ${products.length} products`);
await prisma.$disconnect();
