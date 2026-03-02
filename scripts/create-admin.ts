/**
 * One-time script to create or update the admin user.
 * Usage: npm run seed:admin
 * Requires in .env: ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD (or set when prompted)
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  if (!email?.trim()) {
    console.error('Missing ADMIN_EMAIL in .env');
    process.exit(1);
  }

  let password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password?.trim()) {
    console.error('Set ADMIN_INITIAL_PASSWORD in .env or pass it when we add prompt support.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      emailVerified: true,
      role: 'ADMIN',
      passwordHash,
    },
    update: {
      role: 'ADMIN',
      passwordHash,
    },
  });

  console.log('Admin user ready:', admin.email, '(role:', admin.role + ')');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
