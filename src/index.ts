import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import addressesRoutes from './routes/addresses.js';
import categoriesRoutes from './routes/categories.js';
import productsRoutes from './routes/products.js';
import cartRoutes from './routes/cart.js';
import ordersRoutes from './routes/orders.js';
import couponsRoutes from './routes/coupons.js';
import settingsRoutes from './routes/settings.js';
import campusesRoutes from './routes/campuses.js';
import adminRoutes from './routes/admin/index.js';

const app = express();

const corsOptions = {
  origin: config.corsOrigins.length > 1 ? config.corsOrigins : config.corsOrigin,
  credentials: true,
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/users/me', usersRoutes);
app.use('/users/me/addresses', addressesRoutes);
app.use('/categories', categoriesRoutes);
app.use('/products', productsRoutes);
app.use('/cart', cartRoutes);
app.use('/orders', ordersRoutes);
app.use('/coupons', couponsRoutes);
app.use('/settings', settingsRoutes);
app.use('/campuses', campusesRoutes);
app.use('/admin', adminRoutes);

app.listen(config.port, () => {
  console.log(`Snacqo API listening on http://localhost:${config.port}`);
});
