import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const productListSelect = {
  id: true,
  slug: true,
  name: true,
  shortDescription: true,
  cardLabel: true,
  sortOrder: true,
  category: { select: { id: true, name: true, slug: true } },
  images: {
    orderBy: { sortOrder: 'asc' as const },
    take: 5,
    select: { id: true, url: true, sortOrder: true },
  },
  variants: {
    where: { isActive: true },
    orderBy: { name: 'asc' as const },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      compareAtPrice: true,
      stock: true,
      outOfStock: true,
    },
  },
};

// GET /products ?category=slug&sort=price-asc|price-desc|name
router.get('/', async (req, res) => {
  try {
    const categorySlug = typeof req.query.category === 'string' ? req.query.category.trim() : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : undefined;

    const where: { isActive: boolean; category?: { slug: string } } = { isActive: true };
    if (categorySlug) {
      where.category = { slug: categorySlug };
    }

    type OrderBy = { sortOrder?: 'asc'; name?: 'asc' | 'desc' };
    let orderBy: OrderBy = { sortOrder: 'asc' };
    if (sort === 'price-asc' || sort === 'name') {
      orderBy = { name: 'asc' };
    } else if (sort === 'price-desc') {
      orderBy = { name: 'desc' };
    }

    const products = await prisma.product.findMany({
      where,
      orderBy,
      select: productListSelect,
    });

    res.json({ products });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /products/:slug/reviews – product reviews (from order reviews for orders that contained this product)
router.get('/:slug/reviews', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!slug) {
      res.status(400).json({ error: 'Product slug is required.' });
      return;
    }
    const product = await prisma.product.findUnique({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    const orderReviews = await prisma.orderReview.findMany({
      where: {
        order: {
          items: {
            some: {
              variant: { productId: product.id },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        text: true,
        imageUrls: true,
        videoUrl: true,
        reviewerFirstName: true,
        reviewerLastName: true,
        createdAt: true,
      },
    });
    res.json({ reviews: orderReviews });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /products/:slug
router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!slug) {
      res.status(400).json({ error: 'Product slug is required.' });
      return;
    }

    const product = await prisma.product.findUnique({
      where: { slug, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        shortDescription: true,
        cardLabel: true,
        ingredients: true,
        nutrition: true,
        sortOrder: true,
        category: { select: { id: true, name: true, slug: true } },
        images: {
          orderBy: { sortOrder: 'asc' as const },
          select: { id: true, url: true, sortOrder: true },
        },
        variants: {
          where: { isActive: true },
          orderBy: { name: 'asc' as const },
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            compareAtPrice: true,
            stock: true,
            weightGrams: true,
            outOfStock: true,
          },
        },
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    res.json({ product });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
