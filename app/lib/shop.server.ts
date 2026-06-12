import prisma from "../db.server";
import type { Plan } from "@prisma/client";

export async function upsertShop(shop: string): Promise<{ id: string; plan: Plan; usageThisCycle: number; cycleStart: Date }> {
  return prisma.shop.upsert({
    where: { shop },
    create: { shop },
    update: {},
    select: { id: true, plan: true, usageThisCycle: true, cycleStart: true },
  });
}

export async function getShop(shop: string) {
  return prisma.shop.findUnique({ where: { shop } });
}

export async function getShopById(id: string) {
  return prisma.shop.findUnique({ where: { id } });
}
