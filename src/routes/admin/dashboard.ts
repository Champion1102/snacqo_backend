import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /admin/dashboard – counts: orders today/week, revenue, low stock, etc.
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const [
      ordersToday,
      ordersThisWeek,
      revenueToday,
      revenueThisWeek,
      totalOrders,
      lowStockVariants,
      activeProducts,
      activeCoupons,
    ] = await Promise.all([
      prisma.order.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      prisma.order.count({
        where: { createdAt: { gte: startOfWeek } },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: startOfToday } },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: startOfWeek } },
        _sum: { total: true },
      }),
      prisma.order.count(),
      prisma.productVariant.findMany({
        where: {
          isActive: true,
          OR: [
            { stock: { lte: 5 } },
            { outOfStock: true },
          ],
        },
        select: {
          id: true,
          name: true,
          sku: true,
          stock: true,
          outOfStock: true,
          product: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.product.count({ where: { isActive: true } }),
      prisma.coupon.count({ where: { isActive: true } }),
    ]);

    res.json({
      orders: {
        today: ordersToday,
        thisWeek: ordersThisWeek,
        total: totalOrders,
      },
      revenue: {
        todayPaise: revenueToday._sum.total ?? 0,
        thisWeekPaise: revenueThisWeek._sum.total ?? 0,
      },
      lowStock: lowStockVariants,
      counts: {
        activeProducts,
        activeCoupons,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
