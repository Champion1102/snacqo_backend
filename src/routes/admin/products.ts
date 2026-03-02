import { Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import multer from 'multer';
import { requireAdmin } from '../../middleware/auth.js';
import { uploadImage } from '../../services/cloudinary.js';

const router = Router();
const prisma = new PrismaClient();

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, url: true, sortOrder: true } },
  variants: { orderBy: { name: 'asc' as const }, select: { id: true, name: true, sku: true, price: true, compareAtPrice: true, stock: true, weightGrams: true, isActive: true, outOfStock: true } },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (jpeg, png, gif, webp) are allowed.'));
  },
});

// GET /admin/products ?category=&active=
router.get('/', requireAdmin, async (req, res) => {
  try {
    const categoryId = typeof req.query.category === 'string' ? req.query.category.trim() : undefined;
    const active = req.query.active;
    const isActive = active === 'true' ? true : active === 'false' ? false : undefined;

    const where: { categoryId?: string; isActive?: boolean } = {};
    if (categoryId) where.categoryId = categoryId;
    if (isActive !== undefined) where.isActive = isActive;

    const products = await prisma.product.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: productInclude,
    });
    res.json({ products });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /admin/products  { name, slug, categoryId, description, shortDescription?, ingredients?, nutrition?, isActive?, sortOrder? }
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      name?: string;
      slug?: string;
      categoryId?: string;
      description?: string;
      shortDescription?: string;
      ingredients?: string | null;
      nutrition?: unknown;
      cardLabel?: string | null;
      isActive?: boolean;
      sortOrder?: number;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase().replace(/\s+/g, '-') : undefined;
    const categoryId = typeof body.categoryId === 'string' ? body.categoryId.trim() : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const shortDescription = typeof body.shortDescription === 'string' ? body.shortDescription.trim() || null : null;
    const ingredients = typeof body.ingredients === 'string' ? body.ingredients.trim() || null : null;
    const cardLabel = typeof body.cardLabel === 'string' ? body.cardLabel.trim() || null : body.cardLabel === null ? null : undefined;
    const nutrition = Array.isArray(body.nutrition)
      ? (body.nutrition
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const r = row as { label?: unknown; value?: unknown };
            const label = typeof r.label === 'string' ? r.label.trim() : '';
            const value = typeof r.value === 'string' ? r.value.trim() : '';
            if (!label || !value) return null;
            return { label, value };
          })
          .filter(Boolean) as { label: string; value: string }[])
      : undefined;
    const isActive = body.isActive !== false;
    const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;

    if (!name || !slug || !categoryId) {
      res.status(400).json({ error: 'name, slug, and categoryId are required.' });
      return;
    }

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      res.status(400).json({ error: 'Category not found.' });
      return;
    }

    const product = await prisma.product.create({
      data: {
        name,
        slug,
        categoryId,
        description,
        shortDescription,
        ingredients,
        ...(cardLabel !== undefined ? { cardLabel } : {}),
        ...(nutrition !== undefined ? { nutrition: nutrition.length > 0 ? nutrition : Prisma.DbNull } : {}),
        isActive,
        sortOrder,
      },
      include: productInclude,
    });
    res.status(201).json({ product });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      res.status(409).json({ error: 'A product with this slug already exists.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /admin/products/:id
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const product = await prisma.product.findUnique({
      where: { id },
      include: productInclude,
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

// PATCH /admin/products/:id  partial product fields
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body as {
      name?: string;
      slug?: string;
      categoryId?: string;
      description?: string;
      shortDescription?: string;
      ingredients?: string | null;
      nutrition?: unknown;
      cardLabel?: string | null;
      isActive?: boolean;
      sortOrder?: number;
    };
    const data: Record<string, unknown> = {};
    if (typeof body.name === 'string') data.name = body.name.trim();
    if (typeof body.slug === 'string') data.slug = body.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (typeof body.categoryId === 'string') data.categoryId = body.categoryId.trim();
    if (typeof body.description === 'string') data.description = body.description.trim();
    if (body.shortDescription !== undefined) data.shortDescription = body.shortDescription === null || body.shortDescription === '' ? null : String(body.shortDescription).trim();
    if (body.ingredients !== undefined) data.ingredients = body.ingredients === null || body.ingredients === '' ? null : String(body.ingredients).trim();
    if (body.cardLabel !== undefined) data.cardLabel = body.cardLabel === null || body.cardLabel === '' ? null : String(body.cardLabel).trim();
    if (body.nutrition !== undefined) {
      if (body.nutrition == null) data.nutrition = Prisma.DbNull;
      else if (Array.isArray(body.nutrition)) {
        const normalized = body.nutrition
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const r = row as { label?: unknown; value?: unknown };
            const label = typeof r.label === 'string' ? r.label.trim() : '';
            const value = typeof r.value === 'string' ? r.value.trim() : '';
            if (!label || !value) return null;
            return { label, value };
          })
          .filter(Boolean);
        data.nutrition = normalized.length > 0 ? normalized : Prisma.DbNull;
      } else {
        res.status(400).json({ error: 'nutrition must be an array of { label, value }.' });
        return;
      }
    }
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const product = await prisma.product.update({
      where: { id },
      data,
      include: productInclude,
    });
    res.json({ product });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: string }).code;
      if (code === 'P2025') {
        res.status(404).json({ error: 'Product not found.' });
        return;
      }
      if (code === 'P2002') res.status(409).json({ error: 'Slug or category conflict.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE /admin/products/:id  – soft delete (set isActive false)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const product = await prisma.product.update({
      where: { id },
      data: { isActive: false },
      include: productInclude,
    });
    res.json({ product });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /admin/products/:id/variants  { name, sku, price (paise), compareAtPrice?, stock?, weightGrams?, outOfStock? }
router.post('/:id/variants', requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    const body = req.body as {
      name?: string;
      sku?: string;
      price?: number;
      compareAtPrice?: number | null;
      stock?: number;
      weightGrams?: number | null;
      outOfStock?: boolean;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const sku = typeof body.sku === 'string' ? body.sku.trim().toUpperCase() : undefined;
    const price = typeof body.price === 'number' ? Math.max(0, Math.floor(body.price)) : undefined;
    const compareAtPrice = body.compareAtPrice != null ? Math.max(0, Math.floor(Number(body.compareAtPrice))) : null;
    const stock = typeof body.stock === 'number' ? Math.max(0, Math.floor(body.stock)) : 0;
    const weightGrams = body.weightGrams != null ? Math.max(0, Math.floor(Number(body.weightGrams))) : null;
    const outOfStock = body.outOfStock === true;

    if (!name || !sku || price === undefined) {
      res.status(400).json({ error: 'name, sku, and price (paise) are required.' });
      return;
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const variant = await prisma.productVariant.create({
      data: { productId, name, sku, price, compareAtPrice, stock, weightGrams, outOfStock },
    });
    const updated = await prisma.product.findUnique({
      where: { id: productId },
      include: productInclude,
    });
    res.status(201).json({ variant, product: updated });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e) {
      if ((e as { code: string }).code === 'P2002') res.status(409).json({ error: 'SKU already exists.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PATCH /admin/products/:id/variants/:vid  partial variant (incl. outOfStock toggle)
router.patch('/:id/variants/:vid', requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    const vid = req.params.vid;
    const body = req.body as {
      name?: string;
      sku?: string;
      price?: number;
      compareAtPrice?: number | null;
      stock?: number;
      weightGrams?: number | null;
      isActive?: boolean;
      outOfStock?: boolean;
    };
    const data: Record<string, unknown> = {};
    if (typeof body.name === 'string') data.name = body.name.trim();
    if (typeof body.sku === 'string') data.sku = body.sku.trim().toUpperCase();
    if (typeof body.price === 'number') data.price = Math.max(0, Math.floor(body.price));
    if (body.compareAtPrice !== undefined) data.compareAtPrice = body.compareAtPrice == null ? null : Math.max(0, Math.floor(Number(body.compareAtPrice)));
    if (typeof body.stock === 'number') data.stock = Math.max(0, Math.floor(body.stock));
    if (body.weightGrams !== undefined) data.weightGrams = body.weightGrams == null ? null : Math.max(0, Math.floor(Number(body.weightGrams)));
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.outOfStock === 'boolean') data.outOfStock = body.outOfStock;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const variant = await prisma.productVariant.findFirst({
      where: { id: vid, productId },
    });
    if (!variant) {
      res.status(404).json({ error: 'Variant not found.' });
      return;
    }

    const updated = await prisma.productVariant.update({
      where: { id: vid },
      data,
    });
    res.json({ variant: updated });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: string }).code;
      if (code === 'P2025') {
        res.status(404).json({ error: 'Variant not found.' });
        return;
      }
      if (code === 'P2002') res.status(409).json({ error: 'SKU already exists.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE /admin/products/:id/variants/:vid  – only if not in cart/order
router.delete('/:id/variants/:vid', requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    const vid = req.params.vid;

    const variant = await prisma.productVariant.findFirst({
      where: { id: vid, productId },
      include: {
        _count: { select: { cartItems: true, orderItems: true } },
      },
    });
    if (!variant) {
      res.status(404).json({ error: 'Variant not found.' });
      return;
    }
    if (variant._count.cartItems > 0 || variant._count.orderItems > 0) {
      res.status(400).json({ error: 'Cannot delete variant that is in cart or orders. Deactivate it instead.' });
      return;
    }

    await prisma.productVariant.delete({ where: { id: vid } });
    res.status(204).send();
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
      res.status(404).json({ error: 'Variant not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /admin/products/:id/images  – multipart file(s); upload to Cloudinary, save URL + sortOrder
router.post('/:id/images', requireAdmin, upload.array('images', 10), async (req, res) => {
  try {
    const productId = req.params.id;
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      res.status(400).json({ error: 'No image files provided. Use field name "images".' });
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { images: { orderBy: { sortOrder: 'desc' }, take: 1 } },
    });
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    let nextSortOrder = (product.images[0]?.sortOrder ?? -1) + 1;
    const created: { id: string; url: string; sortOrder: number }[] = [];

    for (const file of files) {
      const { url } = await uploadImage(file.buffer, { folder: 'snacqo/products' });
      const img = await prisma.productImage.create({
        data: { productId, url, sortOrder: nextSortOrder++ },
      });
      created.push({ id: img.id, url: img.url, sortOrder: img.sortOrder });
    }

    res.status(201).json({ images: created });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'Image upload failed.' });
  }
});

// PATCH /admin/products/:id/images/:imgId  { sortOrder }
router.patch('/:id/images/:imgId', requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    const imgId = req.params.imgId;
    const body = req.body as { sortOrder?: number };
    const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : undefined;
    if (sortOrder === undefined) {
      res.status(400).json({ error: 'sortOrder is required.' });
      return;
    }

    const image = await prisma.productImage.findFirst({
      where: { id: imgId, productId },
    });
    if (!image) {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }

    const updated = await prisma.productImage.update({
      where: { id: imgId },
      data: { sortOrder },
    });
    res.json({ image: updated });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE /admin/products/:id/images/:imgId
router.delete('/:id/images/:imgId', requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    const imgId = req.params.imgId;

    const image = await prisma.productImage.findFirst({
      where: { id: imgId, productId },
    });
    if (!image) {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }

    await prisma.productImage.delete({ where: { id: imgId } });
    res.status(204).send();
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
