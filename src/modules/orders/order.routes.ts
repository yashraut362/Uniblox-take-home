import { Router } from "express";
import { z } from "zod";
import * as orderService from "./order.service.js";

export const orderRouter = Router();

const cartParams = z.object({ cartId: z.uuid() });
const orderParams = z.object({ orderId: z.uuid() });

orderRouter.post("/carts/:cartId/checkout", async (req, res) => {
  const { cartId } = cartParams.parse(req.params);
  res.status(201).json(await orderService.checkout(cartId));
});

orderRouter.get("/orders/:orderId", async (req, res) => {
  const { orderId } = orderParams.parse(req.params);
  res.json(await orderService.getOrder(orderId));
});
