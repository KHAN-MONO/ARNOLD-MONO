'use strict';
// Email module - fully safe, never crashes even if nodemailer unavailable

async function sendEmail({ to, subject, html }) {
  try {
    const nm = require('nodemailer');
    if (!nm || !nm.createTransport) {
      console.warn('nodemailer not available');
      return;
    }
    const transporter = nm.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    await transporter.sendMail({
      from: `"monocomplex.ai" <${process.env.EMAIL_FROM}>`,
      to, subject, html,
    });
    console.log('✅ Email sent to', to);
  } catch (err) {
    console.warn('Email failed (non-critical):', err.message);
  }
}

async function sendWelcomeEmail(user) {
  await sendEmail({
    to: user.email,
    subject: 'Welcome to monocomplex.ai 🎬',
    html: `<div style="font-family:sans-serif;padding:2rem;background:#080808;color:#f4f1eb;border-radius:8px;">
      <h1 style="color:#00aaff;">Welcome to monocomplex.ai! 🎬</h1>
      <p>Hey ${user.name}, you're in! 🚀</p>
      <p>Your <strong>${user.plan}</strong> plan is now active.</p>
      <a href="${process.env.FRONTEND_URL || 'https://khan-mono.github.io/ARNOLD-MONO'}/dashboard" 
         style="display:inline-block;background:#00aaff;color:#000;padding:.75rem 1.5rem;border-radius:4px;font-weight:700;text-decoration:none;margin-top:1rem;">
        Go to Dashboard →
      </a>
    </div>`,
  });
}

async function sendPasswordResetEmail(user, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL || 'https://khan-mono.github.io/ARNOLD-MONO'}/reset-password?token=${resetToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your monocomplex.ai password',
    html: `<div style="font-family:sans-serif;padding:2rem;background:#080808;color:#f4f1eb;border-radius:8px;">
      <h1 style="color:#00aaff;">Password Reset</h1>
      <p>Hi ${user.name}, click below to reset your password. Expires in 1 hour.</p>
      <a href="${resetUrl}" style="display:inline-block;background:#00aaff;color:#000;padding:.75rem 1.5rem;border-radius:4px;font-weight:700;text-decoration:none;margin-top:1rem;">
        Reset Password →
      </a>
    </div>`,
  });
}

async function sendPaymentConfirmEmail(user, payment) {
  await sendEmail({
    to: user.email,
    subject: `Payment confirmed — ${payment.plan} plan ✓`,
    html: `<div style="font-family:sans-serif;padding:2rem;background:#080808;color:#f4f1eb;border-radius:8px;">
      <h1 style="color:#00d084;">Payment Successful ✓</h1>
      <p>Hi ${user.name}, your ${payment.plan} plan is now active.</p>
      <p>Amount: <strong>${payment.currency} ${payment.amount}</strong></p>
      <p>Reference: ${payment.reference}</p>
    </div>`,
  });
}

module.exports = { sendEmail, sendWelcomeEmail, sendPasswordResetEmail, sendPaymentConfirmEmail };
