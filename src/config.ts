import { z } from "zod";

const env = z
  .object({
    COUPON_EVERY_N_ORDERS: z.coerce.number().int().positive(),
    COUPON_PERCENT: z.coerce.number().int().min(1).max(100),
  })
  .parse(process.env);

export const config = {
  couponEveryNOrders: env.COUPON_EVERY_N_ORDERS,
  couponPercent: env.COUPON_PERCENT,
};
