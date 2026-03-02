import nodemailer from 'nodemailer';
import { config } from '../config.js';

function isZohoConfigured(): boolean {
  const { smtpHost, smtpUser, smtpPass } = config.zoho;
  return !!(smtpHost && smtpUser && smtpPass);
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  if (isZohoConfigured()) {
    const transporter = nodemailer.createTransport({
      host: config.zoho.smtpHost,
      port: 465,
      secure: true,
      auth: {
        user: config.zoho.smtpUser,
        pass: config.zoho.smtpPass,
      },
    });

    await transporter.sendMail({
      from: `"Snacqo" <${config.zoho.smtpUser}>`,
      to: email,
      subject: 'Your Snacqo login code',
      text: `Your one-time login code is: ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
      html: `
        <p>Your one-time login code is: <strong>${code}</strong></p>
        <p>It expires in 10 minutes.</p>
        <p>If you didn't request this, you can ignore this email.</p>
      `.trim(),
    });
    return;
  }

  // Dev fallback when Zoho is not configured
  console.log(`[Email] OTP for ${email}: ${code}`);
}
