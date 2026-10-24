import { Router } from "express";
import { z } from "zod";
import * as cartService from "./cart.service.js";

export const cartRouter = Router();

const cartParams = z.object({ cartId: z.uuid() });
const cartItemParams = cartParams.extend({ productId: z.uuid() });
const addItemBody = z.object({ productId: z.uuid(), quantity: z.int().positive() });
const updateItemBody = z.object({ quantity: z.int().positive() });

cartRouter.post("/carts", async (_req, res) => {
  res.status(201).json(await cartService.createCart());
});

cartRouter.get("/carts/:cartId", async (req, res) => {
  const { cartId } = cartParams.parse(req.params);
  res.json(await cartService.getCart(cartId));
});

cartRouter.post("/carts/:cartId/items", async (req, res) => {
  const { cartId } = cartParams.parse(req.params);
  const { productId, quantity } = addItemBody.parse(req.body);
  res.json(await cartService.addItem(cartId, productId, quantity));
});

cartRouter.patch("/carts/:cartId/items/:productId", async (req, res) => {
  const { cartId, productId } = cartItemParams.parse(req.params);
  const { quantity } = updateItemBody.parse(req.body);
  res.json(await cartService.updateItemQuantity(cartId, productId, quantity));
});

cartRouter.delete("/carts/:cartId/items/:productId", async (req, res) => {
  const { cartId, productId } = cartItemParams.parse(req.params);
  res.json(await cartService.removeItem(cartId, productId));
});
