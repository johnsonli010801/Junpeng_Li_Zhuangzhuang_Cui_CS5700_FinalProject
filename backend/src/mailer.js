import nodemailer from 'nodemailer';
import { logger } from './logger.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 2525),
  secure: false, // Mailtrap 使用 STARTTLS，不要启用 SMTPS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * 发送登录 MFA 验证码邮件
 *
 * 注意：为了避免骚扰真实邮箱，这里**强制**把收件人改成固定的 Mailtrap sandbox 邮箱。
 * - 用户在前端输入的邮箱仍会用于账号匹配与展示
 * - 实际发送的目标邮箱由环境变量 MFA_SANDBOX_TO 控制
 */
export async function sendMfaCodeEmail(toEmail, code) {
  const sandboxTo = process.env.MFA_SANDBOX_TO;
  if (!sandboxTo) {
    throw new Error('MFA_SANDBOX_TO 未配置，无法发送 MFA 邮件');
  }

  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || 'YouChat MFA <no-reply@youchat.local>',
    to: sandboxTo,
    subject: 'YouChat 登录验证码',
    text: `【YouChat】登录验证码：${code}，5 分钟内有效。\n\n原始登录邮箱（仅用于展示，不会真实发送）：${toEmail}`,
    html: `
      <p>【YouChat】登录验证码：<b style="font-size: 20px;">${code}</b></p>
      <p>该验证码将在 <b>5 分钟</b> 后失效。</p>
      <hr />
      <p style="font-size: 12px; color: #666;">
        原始登录邮箱（仅用于教学演示，并不会真实发送到该地址）：${toEmail}
      </p>
    `,
  });

  logger.info('MFA email sent via Mailtrap sandbox', {
    messageId: info.messageId,
    sandboxTo,
    originalTo: toEmail,
  });
}


