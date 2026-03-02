import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import ordersRouter from './orders.js';
import categoriesRouter from './categories.js';
import productsRouter from './products.js';
import couponsRouter from './coupons.js';
import campusesRouter from './campuses.js';
import dashboardRouter from './dashboard.js';
import settingsRouter from './settings.js';

const router = Router();

// All /admin/* require admin JWT
router.use(requireAdmin);

router.use('/orders', ordersRouter);
router.use('/categories', categoriesRouter);
router.use('/products', productsRouter);
router.use('/coupons', couponsRouter);
router.use('/campuses', campusesRouter);
router.use('/dashboard', dashboardRouter);
router.use('/settings', settingsRouter);

export default router;
