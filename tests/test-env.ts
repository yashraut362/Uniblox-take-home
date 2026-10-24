import "dotenv/config";

const url = new URL(process.env.DATABASE_URL!);
url.pathname = "/uniblox_test";

export const testEnv = {
  DATABASE_URL: url.toString(),
  COUPON_EVERY_N_ORDERS: "3",
  COUPON_PERCENT: "10",
};
