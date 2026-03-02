import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OTP_EXPIRY_MINUTES = 10;
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_MINUTES = 15;

function generateCode(): string {
  return Math.floor(100_000 + Math.random() * 900_000).toString();
}

export async function createAndSendOtp(
  email: string,
  sendEmail: (email: string, code: string) => Promise<void>
): Promise<{ success: true } | { success: false; message: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { success: false, message: 'Email is required.' };
  }

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);
  const recentCount = await prisma.otp.count({
    where: { email: normalized, createdAt: { gte: windowStart } },
  });
  if (recentCount >= RATE_LIMIT_COUNT) {
    return { success: false, message: 'Too many attempts. Try again later.' };
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.otp.create({
    data: { email: normalized, otp: code, expiresAt },
  });

  await sendEmail(normalized, code);
  return { success: true };
}

export async function verifyOtp(
  email: string,
  otp: string
): Promise<{ valid: true } | { valid: false; message: string }> {
  const normalized = email.trim().toLowerCase();
  const record = await prisma.otp.findFirst({
    where: { email: normalized, otp },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return { valid: false, message: 'Invalid or expired code.' };
  }
  if (record.expiresAt < new Date()) {
    return { valid: false, message: 'Code has expired.' };
  }

  await prisma.otp.deleteMany({ where: { email: normalized } });
  return { valid: true };
}
