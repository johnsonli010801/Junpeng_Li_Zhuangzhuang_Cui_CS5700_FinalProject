import nodemailer from 'nodemailer';
import { logger } from './logger.js';
import { googleEmailConfig } from './config/googleEmailConfig.js';

// Send emails using Gmail SMTP with simple username + password auth.
// This is ONLY used to send MFA verification codes, not for Google OAuth / SSO login.
const transporter = nodemailer.createTransport({
  host: googleEmailConfig.host,
  port: googleEmailConfig.port,
  secure: googleEmailConfig.secure,
  auth: {
    user: googleEmailConfig.user,
    pass: googleEmailConfig.pass,
  },
});

/**
 * Send login MFA verification code email.
 *
 * Important:
 * - This only sends a 6-digit code to the user's email via Google email service.
 * - The system still uses its own "email + password" account model for authentication.
 * - Backend only checks whether the user can receive email for that address;
 *   it does NOT perform Google account OAuth login.
 */
export async function sendMfaCodeEmail(toEmail, code) {
  const info = await transporter.sendMail({
    from: googleEmailConfig.from || `YouChat Security <${googleEmailConfig.user}>`,
    // Send to the same email used on the login form, to verify ownership via code.
    to: toEmail,
    subject: 'Your YouChat login verification code',
    text: `[YouChat] Your login verification code is: ${code} (valid for 5 minutes).\n\nIf you did not request this, you can safely ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>YouChat Login Verification Code</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              background-color: #0f172a;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              color: #e5e7eb;
            }
            .wrapper {
              width: 100%;
              padding: 32px 16px;
              box-sizing: border-box;
            }
            .card {
              max-width: 480px;
              margin: 0 auto;
              background: radial-gradient(circle at top left, #22d3ee33, #0f172a 55%) border-box,
                         linear-gradient(145deg, #1f2937, #020617) padding-box;
              border-radius: 18px;
              border: 1px solid rgba(148, 163, 184, 0.4);
              box-shadow: 0 22px 45px rgba(15, 23, 42, 0.75);
              padding: 28px 24px 24px;
            }
            .logo {
              font-size: 20px;
              font-weight: 700;
              letter-spacing: 0.04em;
              display: inline-flex;
              align-items: center;
              gap: 8px;
              color: #e5e7eb;
            }
            .logo-badge {
              width: 26px;
              height: 26px;
              border-radius: 999px;
              background: conic-gradient(from 180deg, #22d3ee, #6366f1, #8b5cf6, #22d3ee);
              display: inline-flex;
              align-items: center;
              justify-content: center;
              color: #020617;
              font-size: 14px;
              font-weight: 800;
            }
            h1 {
              margin: 18px 0 4px;
              font-size: 22px;
              color: #f9fafb;
            }
            p {
              margin: 4px 0;
              font-size: 14px;
              line-height: 1.6;
              color: #cbd5f5;
            }
            .code-box {
              margin: 20px 0 12px;
              padding: 14px 18px;
              border-radius: 14px;
              background: rgba(15, 23, 42, 0.9);
              border: 1px solid rgba(148, 163, 184, 0.6);
              display: inline-flex;
              letter-spacing: 0.48em;
              font-size: 26px;
              font-weight: 700;
              color: #e5e7eb;
            }
            .meta {
              font-size: 12px;
              color: #9ca3af;
              margin-top: 10px;
            }
            .footer {
              margin-top: 28px;
              font-size: 11px;
              color: #6b7280;
              border-top: 1px dashed rgba(55, 65, 81, 0.9);
              padding-top: 14px;
            }
            .footer strong {
              color: #e5e7eb;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="card">
              <div class="logo">
                <span class="logo-badge">Y</span>
                YouChat Security
              </div>
              <h1>Your login verification code</h1>
              <p>Use the following 6-digit code to finish signing in to your YouChat account:</p>
              <div class="code-box">${code}</div>
              <p class="meta">This code will expire in <strong>5 minutes</strong>. For your security, do not share it with anyone.</p>
              <p class="footer">
                If you did not attempt to sign in, you can safely ignore this email — no changes will be made to your account.<br />
                <br />
                <strong>YouChat Security Team</strong>
              </p>
            </div>
          </div>
        </body>
      </html>
    `,
  });

  logger.info('MFA email sent via Google email service', {
    messageId: info.messageId,
    to: toEmail,
  });
}



