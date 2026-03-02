import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /admin/dashboard – counts: orders today/week, revenue, low stock, analytics, charts
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfLast30Days = new Date(startOfToday);
    startOfLast30Days.setDate(startOfLast30Days.getDate() - 30);

    const [
      ordersToday,
      ordersThisWeek,
      revenueToday,
      revenueThisWeek,
      totalOrders,
      deliveredCount,
      cancelledCount,
      lowStockVariants,
      activeProducts,
      activeCoupons,
      ordersLast30Days,
      itemsWithOrderId,
    ] = await Promise.all([
      prisma.order.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      prisma.order.count({
        where: { createdAt: { gte: startOfWeek } },
      }),
      // Revenue: only orders where Razorpay payment status is captured (successful payment)
      prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfToday },
          razorpayPaymentStatus: 'captured',
        },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfWeek },
          razorpayPaymentStatus: 'captured',
        },
        _sum: { total: true },
      }),
      prisma.order.count(),
      prisma.order.count({ where: { status: 'DELIVERED' } }),
      prisma.order.count({ where: { status: 'CANCELLED' } }),
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
      // Orders per day for last 30 days (for chart)
      prisma.order.findMany({
        where: { createdAt: { gte: startOfLast30Days } },
        select: { createdAt: true, total: true, razorpayPaymentStatus: true },
      }),
      // Product-wise: order items from delivered orders
      prisma.orderItem.findMany({
        where: { order: { status: 'DELIVERED' } },
        select: {
          orderId: true,
          quantity: true,
          variant: { select: { productId: true, product: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    const productMap = new Map<string, { productId: string; productName: string; quantitySold: number; orderIds: Set<string> }>();
    for (const item of itemsWithOrderId) {
      const productId = item.variant.product.id;
      const productName = item.variant.product.name;
      if (!productMap.has(productId)) {
        productMap.set(productId, { productId, productName, quantitySold: 0, orderIds: new Set() });
      }
      const rec = productMap.get(productId)!;
      rec.quantitySold += item.quantity;
      rec.orderIds.add(item.orderId);
    }
    const productWiseOrders = Array.from(productMap.entries())
      .map(([, rec]) => ({
        productId: rec.productId,
        productName: rec.productName,
        quantitySold: rec.quantitySold,
        orderCount: rec.orderIds.size,
      }))
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 10);

    // Build orders by day and revenue by day for last 30 days
    const ordersByDay: { date: string; orders: number; revenuePaise: number }[] = [];
    for (let d = 29; d >= 0; d--) {
      const day = new Date(startOfToday);
      day.setDate(day.getDate() - d);
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const dayOrders = ordersLast30Days.filter(
        (o) => o.createdAt >= dayStart && o.createdAt < dayEnd
      );
      const dayRevenue = dayOrders
        .filter((o) => o.razorpayPaymentStatus === 'captured')
        .reduce((sum, o) => sum + o.total, 0);
      ordersByDay.push({
        date: dayStart.toISOString().slice(0, 10),
        orders: dayOrders.length,
        revenuePaise: dayRevenue,
      });
    }

    // Orders by status for pie chart
    const [pending, processing, shipped, outForDelivery, delivered, cancelled] = await Promise.all([
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.order.count({ where: { status: 'PROCESSING' } }),
      prisma.order.count({ where: { status: 'SHIPPED' } }),
      prisma.order.count({ where: { status: 'OUT_FOR_DELIVERY' } }),
      prisma.order.count({ where: { status: 'DELIVERED' } }),
      prisma.order.count({ where: { status: 'CANCELLED' } }),
    ]);
    const ordersByStatus = [
      { name: 'Pending', value: pending, status: 'PENDING' },
      { name: 'Processing', value: processing, status: 'PROCESSING' },
      { name: 'Shipped', value: shipped, status: 'SHIPPED' },
      { name: 'Out for delivery', value: outForDelivery, status: 'OUT_FOR_DELIVERY' },
      { name: 'Delivered', value: delivered, status: 'DELIVERED' },
      { name: 'Cancelled', value: cancelled, status: 'CANCELLED' },
    ].filter((s) => s.value > 0);

    res.json({
      orders: {
        today: ordersToday,
        thisWeek: ordersThisWeek,
        total: totalOrders,
        delivered: deliveredCount,
        cancelled: cancelledCount,
      },
      revenue: {
        todayPaise: revenueToday._sum?.total ?? 0,
        thisWeekPaise: revenueThisWeek._sum?.total ?? 0,
      },
      lowStock: lowStockVariants,
      counts: {
        activeProducts,
        activeCoupons,
      },
      productWiseOrders,
      ordersByDay,
      ordersByStatus,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
