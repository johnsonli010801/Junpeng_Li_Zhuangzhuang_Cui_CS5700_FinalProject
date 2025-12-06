import { sendMfaCodeEmail } from './mailer.js';

async function main() {
  const to = process.env.TEST_MFA_TO || 'student@example.com';
  const code = '123456';
  console.log('Sending MFA test email...');
  await sendMfaCodeEmail(to, code);
  console.log('MFA test email sent. Please check Mailtrap sandbox inbox.');
}

main().catch((err) => {
  console.error('Failed to send MFA test email:', err);
  process.exit(1);
});









