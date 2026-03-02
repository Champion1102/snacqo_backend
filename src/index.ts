import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
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

app.use(helmet({ contentSecurityPolicy: false }));

const corsOptions = {
  origin: config.corsOrigins.length > 1 ? config.corsOrigins : config.corsOrigin,
  credentials: true,
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' })); // Explicit limit to mitigate large-body DoS

// Global API rate limit: 150 requests per 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Stricter limit for auth (login, OTP, etc.): 25 per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: { error: 'Too many auth attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/auth', authLimiter, authRoutes);
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
