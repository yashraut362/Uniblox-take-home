import { Router } from "express";
import * as couponService from "./coupon.service.js";

export const couponRouter = Router();

couponRouter.post("/admin/coupons", async (_req, res) => {
  res.status(201).json(await couponService.generateCoupon());
});
