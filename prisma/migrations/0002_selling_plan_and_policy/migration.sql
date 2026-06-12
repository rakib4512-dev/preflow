-- Add selling plan ID (numeric, for the storefront `selling_plan` cart param)
-- and a snapshot of variant inventory policies taken before enabling pre-order.
ALTER TABLE "PreorderConfig" ADD COLUMN "sellingPlanId" TEXT;
ALTER TABLE "PreorderConfig" ADD COLUMN "policySnapshot" JSONB;
