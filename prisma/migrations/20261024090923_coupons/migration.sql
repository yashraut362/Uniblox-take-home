-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('AVAILABLE', 'REDEEMED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponId" INTEGER;

-- CreateTable
CREATE TABLE "Coupon" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "milestone" INTEGER NOT NULL,
    "status" "CouponStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_milestone_key" ON "Coupon"("milestone");

-- CreateIndex
CREATE UNIQUE INDEX "Order_couponId_key" ON "Order"("couponId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

