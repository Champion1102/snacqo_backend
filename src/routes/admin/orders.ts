import { Router } from 'express';
import { PrismaClient, type OrderStatus } from '@prisma/client';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

const ORDER_STATUSES: OrderStatus[] = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

const orderInclude = {
  items: {
    include: {
      variant: {
        select: {
          id: true,
          name: true,
          sku: true,
          price: true,
          product: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  },
};

// GET /admin/orders ?status=&page=&limit=
router.get('/', requireAdmin, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : undefined;
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const skip = (page - 1) * limit;

    const where = status && ORDER_STATUSES.includes(status as OrderStatus)
      ? { status: status as OrderStatus }
      : {};

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          email: true,
          status: true,
          total: true,
          currency: true,
          createdAt: true,
          _count: { select: { items: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /admin/orders/:id
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const order = await prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    res.json({ order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /admin/orders/:id  { status }
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body as { status?: string };
    const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : undefined;

    if (!status || !ORDER_STATUSES.includes(status as OrderStatus)) {
      res.status(400).json({ error: 'Valid status is required: ' + ORDER_STATUSES.join(', ') });
      return;
    }

    const order = await prisma.order.update({
      where: { id },
      data: { status: status as OrderStatus },
      include: orderInclude,
    });
    res.json({ order });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
