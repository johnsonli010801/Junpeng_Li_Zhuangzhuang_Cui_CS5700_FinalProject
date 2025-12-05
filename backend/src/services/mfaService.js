import { nanoid } from 'nanoid';
import { recordLog } from '../auth.js';
import { db, persist } from '../db.js';
import { sanitizeUser } from '../utils/userUtils.js';
import { logger } from '../logger.js';
import { sendMfaCodeEmail } from '../mailer.js';

// MFA 挑战状态保存在内存中，与之前完全一致
const pendingMfaChallenges = new Map();

export function generateNumericCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += Math.floor(Math.random() * 10).toString();
  }
  // Ensure first digit is not 0 for nicer display
  if (code[0] === '0') {
    code = `1${code.slice(1)}`;
  }
  return code;
}

export async function startMfaChallenge(user, ip) {
  const challengeId = nanoid();
  const code = generateNumericCode(6);
  const expiresAt = Date.now() + 5 * 60 * 1000;
  pendingMfaChallenges.set(challengeId, {
    userId: user.id,
    code,
    expiresAt,
  });

  // 保持原先的调试日志逻辑
  // eslint-disable-next-line no-console
  console.log(`\nMFA code generated: ${code}`);
  // eslint-disable-next-line no-console
  console.log(`User email: ${user.email}`);
  // eslint-disable-next-line no-console
  console.log(`Expires at: ${new Date(expiresAt).toLocaleString('zh-CN')}`);
  // eslint-disable-next-line no-console
  console.log(`Challenge ID: ${challengeId}\n`);

  try {
    await sendMfaCodeEmail(user.email, code);
  } catch (error) {
    logger.error(`Failed to send MFA email: ${error.message}`, {
      userId: user.id,
      email: user.email,
    });
    throw new Error('Failed to send verification code, please try again later');
  }

  recordLog('info', 'Triggered email MFA login challenge', {
    userId: user.id,
    ip,
    code, // Handy while developing; remove if this ever goes to real users
  });

  return { challengeId, code };
}

export function verifyMfaToken(challengeId, token, reqIp) {
  // 打印调试信息，保持行为一致
  // eslint-disable-next-line no-console
  console.log(`\nMFA verification request:`);
  // eslint-disable-next-line no-console
  console.log(`Challenge ID: ${challengeId}`);
  // eslint-disable-next-line no-console
  console.log(`User input code: ${token}`);
  // eslint-disable-next-line no-console
  console.log(`Current number of challenges: ${pendingMfaChallenges.size}`);

  const challenge = pendingMfaChallenges.get(challengeId);
  if (!challenge) {
    // eslint-disable-next-line no-console
    console.log(`Challenge not found (possibly cleared after server restart)\n`);
    return { ok: false, status: 400, message: 'Challenge is no longer valid, please log in again' };
  }

  const now = Date.now();
  if (challenge.expiresAt < now) {
    // eslint-disable-next-line no-console
    console.log(`Challenge expired`);
    // eslint-disable-next-line no-console
    console.log(`Expires at: ${new Date(challenge.expiresAt).toLocaleString('zh-CN')}`);
    // eslint-disable-next-line no-console
    console.log(`Current time: ${new Date(now).toLocaleString('zh-CN')}\n`);
    return { ok: false, status: 400, message: 'Verification code has expired, please log in again' };
  }

  const user = db.data.users.find((u) => u.id === challenge.userId);
  if (!user) {
    // eslint-disable-next-line no-console
    console.log(`User not found: ${challenge.userId}\n`);
    return { ok: false, status: 400, message: 'User does not exist' };
  }

  const expectedCode = String(challenge.code || '');
  // eslint-disable-next-line no-console
  console.log(`Expected code: ${expectedCode}`);

  if (!expectedCode || String(token) !== expectedCode) {
    // eslint-disable-next-line no-console
    console.log(`Verification code does not match\n`);
    return { ok: false, status: 400, message: 'Invalid verification code' };
  }

  // eslint-disable-next-line no-console
  console.log(`Verification code correct, login success\n`);
  pendingMfaChallenges.delete(challengeId);

  const ip = reqIp;
  recordLog('info', 'User logged in via email MFA', { userId: user.id, ip });

  return { ok: true, user: sanitizeUser(user), rawUser: user };
}

export function cleanupExpiredChallenges() {
  const now = Date.now();
  for (const [key, value] of pendingMfaChallenges.entries()) {
    if (value.expiresAt < now) {
      pendingMfaChallenges.delete(key);
    }
  }
}


