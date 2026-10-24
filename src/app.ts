import express from "express";
import { prisma } from "./db.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { cartRouter } from "./modules/carts/cart.routes.js";
import { couponRouter } from "./modules/coupons/coupon.routes.js";
import { orderRouter } from "./modules/orders/order.routes.js";
import { productRouter } from "./modules/products/product.routes.js";

export const app = express();

app.use(express.json());

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", db: "ok" });
});

app.use(productRouter);
app.use(cartRouter);
app.use(orderRouter);
app.use(couponRouter);

app.use(notFoundHandler);
app.use(errorHandler);
