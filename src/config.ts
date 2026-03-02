import 'dotenv/config';

function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

export const config = {
  port: parseInt(env('PORT', '3001'), 10),
  databaseUrl: env('DATABASE_URL'),
  jwtSecret: env('JWT_SECRET'),
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean),
  zoho: {
    smtpHost: process.env.ZOHO_SMTP_HOST,
    smtpUser: process.env.ZOHO_SMTP_USER,
    smtpPass: process.env.ZOHO_SMTP_PASS,
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
} as const;
