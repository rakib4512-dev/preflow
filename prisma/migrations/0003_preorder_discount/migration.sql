-- Automatic pre-order discount: GID of the discountAutomaticBasic node
-- and the percentage the merchant chose (0/null = no discount).
ALTER TABLE "PreorderConfig" ADD COLUMN "discountGid" TEXT;
ALTER TABLE "PreorderConfig" ADD COLUMN "discountPercent" INTEGER;
