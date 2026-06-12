import prisma from "../../db.server";
import { upsertShop } from "../../lib/shop.server";

export async function handleAppUninstalled(shop: string): Promise<void> {
  const shopRecord = await upsertShop(shop);

  await prisma.shop.update({
    where: { id: shopRecord.id },
    data: {
      uninstalledAt: new Date(),
      plan: "FREE",
    },
  });

  // Data purge is scheduled 30 days out; a cron job checks uninstalledAt
  // PreorderConfigs are soft-disabled so orphaned metafields become inert
  await prisma.preorderConfig.updateMany({
    where: { shopId: shopRecord.id },
    data: { enabled: false },
  });

  await prisma.session.deleteMany({ where: { shop } });
}
