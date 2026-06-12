-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "BillingEventType" AS ENUM ('USAGE_WARNING_70', 'USAGE_WARNING_100', 'OVERAGE_BILLED', 'PLAN_CHANGED', 'PLAN_CANCELLED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "usageThisCycle" INTEGER NOT NULL DEFAULT 0,
    "cycleStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "uninstalledAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL DEFAULT 'Pre-order now',
    "shipDate" TIMESTAMP(3),
    "sellingPlanGid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreorderOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "BillingEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("webhookId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shop_key" ON "Shop"("shop");

-- CreateIndex
CREATE INDEX "PreorderConfig_shopId_enabled_idx" ON "PreorderConfig"("shopId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "PreorderConfig_shopId_productId_variantId_key" ON "PreorderConfig"("shopId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PreorderOrder_orderGid_key" ON "PreorderOrder"("orderGid");

-- CreateIndex
CREATE INDEX "PreorderOrder_shopId_idx" ON "PreorderOrder"("shopId");

-- CreateIndex
CREATE INDEX "BillingEvent_shopId_type_idx" ON "BillingEvent"("shopId", "type");

-- CreateIndex
CREATE INDEX "ProcessedWebhook_shop_idx" ON "ProcessedWebhook"("shop");

-- AddForeignKey
ALTER TABLE "PreorderConfig" ADD CONSTRAINT "PreorderConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderOrder" ADD CONSTRAINT "PreorderOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
