import nodemailer from 'nodemailer';
import { logger } from './logger.js';
import { googleEmailConfig } from './config/googleEmailConfig.js';

const transporter = nodemailer.createTransport({
  host: googleEmailConfig.host,
  port: googleEmailConfig.port,
  secure: googleEmailConfig.secure,
  auth: {
    user: googleEmailConfig.user,
    pass: googleEmailConfig.pass,
  },
});

// 给用户发登录验证码
export async function sendMfaCodeEmail(toEmail, code) {
  const info = await transporter.sendMail({
    from: googleEmailConfig.from || `YouChat Security <${googleEmailConfig.user}>`,
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
              background-color: #f3f4ff;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              color: #111827;
            }
            .wrapper {
              width: 100%;
              padding: 32px 16px;
              box-sizing: border-box;
            }
            .card {
              max-width: 480px;
              margin: 0 auto;
              background:
                linear-gradient(145deg, rgba(102, 126, 234, 0.14), rgba(118, 75, 162, 0.16)) border-box,
                #ffffff padding-box;
              border-radius: 18px;
              border: 1px solid rgba(129, 140, 248, 0.35);
              box-shadow: 0 18px 40px rgba(79, 70, 229, 0.22);
              padding: 28px 24px 24px;
            }
            .logo {
              font-size: 20px;
              font-weight: 700;
              letter-spacing: 0.04em;
              display: inline-flex;
              align-items: center;
              gap: 8px;
              color: #1f2937;
            }
            h1 {
              margin: 18px 0 4px;
              font-size: 22px;
              color: #111827;
            }
            p {
              margin: 4px 0;
              font-size: 14px;
              line-height: 1.6;
              color: #4b5563;
            }
            .code-box {
              margin: 20px 0 12px;
              padding: 14px 18px;
              border-radius: 14px;
              background: linear-gradient(135deg, #e0e7ff, #ede9fe);
              border: 1px solid rgba(129, 140, 248, 0.8);
              display: inline-flex;
              letter-spacing: 0.48em;
              font-size: 26px;
              font-weight: 700;
              color: #4338ca;
            }
            .meta {
              font-size: 12px;
              color: #6b7280;
              margin-top: 10px;
            }
            .footer {
              margin-top: 28px;
              font-size: 11px;
              color: #6b7280;
              border-top: 1px dashed rgba(148, 163, 184, 0.8);
              padding-top: 14px;
            }
            .footer strong {
              color: #4f46e5;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="card">
              <div class="logo">
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



