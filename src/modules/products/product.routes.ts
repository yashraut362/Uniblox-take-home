import { Router } from "express";
import { z } from "zod";
import * as productService from "./product.service.js";

export const productRouter = Router();

const productParams = z.object({ productId: z.coerce.number().int().positive() });

productRouter.get("/products", async (_req, res) => {
  res.json(await productService.listProducts());
});

productRouter.get("/products/:productId", async (req, res) => {
  const { productId } = productParams.parse(req.params);
  res.json(await productService.getProduct(productId));
});
