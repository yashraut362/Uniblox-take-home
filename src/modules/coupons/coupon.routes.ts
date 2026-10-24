import { Router } from "express";
import * as couponService from "./coupon.service.js";

export const couponRouter = Router();

couponRouter.get("/admin/coupons", async (_req, res) => {
  res.json(await couponService.listCoupons());
});

couponRouter.post("/admin/coupons", async (_req, res) => {
  res.status(201).json(await couponService.generateCoupon());
});
