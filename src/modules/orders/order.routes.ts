import { Router } from "express";
import { z } from "zod";
import * as orderService from "./order.service.js";

export const orderRouter = Router();

const cartParams = z.object({ cartId: z.uuid() });
const orderParams = z.object({ orderId: z.uuid() });
const checkoutBody = z.object({ couponCode: z.string().trim().min(1).toUpperCase().optional() });

orderRouter.post("/carts/:cartId/checkout", async (req, res) => {
  const { cartId } = cartParams.parse(req.params);
  const { couponCode } = checkoutBody.parse(req.body ?? {});
  const { order, created } = await orderService.checkout(cartId, couponCode);
  res.status(created ? 201 : 200).json(order);
});

orderRouter.get("/orders/:orderId", async (req, res) => {
  const { orderId } = orderParams.parse(req.params);
  res.json(await orderService.getOrder(orderId));
});
