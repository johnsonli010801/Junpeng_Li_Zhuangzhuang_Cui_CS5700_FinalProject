// Google email service (Gmail SMTP) configuration
// ⚠️ Notes:
// 1. This is only used to send login verification codes, it is NOT Google OAuth login.
// 2. This file is imported directly by the backend; fill in real credentials before deployment.
// 3. For simplicity in this demo, credentials are kept in a JS file instead of .env.
//    In real production, move them to a secure secret management solution (.env, Secret Manager, etc.).

export const googleEmailConfig = {
  // Gmail SMTP host and port (usually do not need to change)
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // use STARTTLS

  // Gmail account used to send emails
  user: 'youchat.dev@gmail.com',

  // Gmail App Password for the above account (NOT the normal login password)
  pass: 'pnqruqmetqthasjr',

  // Display name for the sender
  from: 'YouChat Security <youchat.dev@gmail.com>',
};


