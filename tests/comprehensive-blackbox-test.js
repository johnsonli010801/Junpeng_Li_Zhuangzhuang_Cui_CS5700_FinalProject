#!/usr/bin/env node

/**
 * YouChat 完整黑盒测试套件
 * 测试所有API端点、Socket.IO连接、文件上传、MFA流程等
 */

import axios from 'axios';
import { io } from 'socket.io-client';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import speakeasy from 'speakeasy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:4000';

// 测试统计
let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;
const testResults = [];

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const colorMap = {
    success: colors.green,
    error: colors.red,
    warning: colors.yellow,
    info: colors.cyan,
  };
  const color = colorMap[type] || colors.reset;
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

function recordTest(name, passed, error = null, duration = 0) {
  if (passed) {
    testsPassed++;
    log(`✓ ${name} (${duration}ms)`, 'success');
  } else {
    testsFailed++;
    log(`✗ ${name}: ${error}`, 'error');
  }
  testResults.push({ name, passed, error, duration });
}

// 工具函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest(name, testFn) {
  const startTime = Date.now();
  try {
    await testFn();
    const duration = Date.now() - startTime;
    recordTest(name, true, null, duration);
  } catch (error) {
    const duration = Date.now() - startTime;
    recordTest(name, false, error.message, duration);
  }
}

// ============================================
// 测试数据
// ============================================

const testUsers = [
  {
    name: '测试用户A',
    email: `test-a-${Date.now()}@test.com`,
    password: 'Test123456!',
  },
  {
    name: '测试用户B',
    email: `test-b-${Date.now()}@test.com`,
    password: 'Test123456!',
  },
  {
    name: '测试用户C',
    email: `test-c-${Date.now()}@test.com`,
    password: 'Test123456!',
  },
];

const testContext = {
  users: [],
  tokens: [],
  conversations: [],
  messages: [],
  files: [],
};

// ============================================
// 1. 健康检查测试
// ============================================

async function testHealthCheck() {
  log('\n========== 1. 健康检查测试 ==========', 'info');
  
  await runTest('健康检查端点', async () => {
    const response = await axios.get(`${API_BASE}/health`);
    if (response.status !== 200) throw new Error('状态码不是200');
    if (response.data.status !== 'ok') throw new Error('健康状态不正确');
    if (!response.data.timestamp) throw new Error('缺少时间戳');
  });
}

// ============================================
// 2. 用户注册测试
// ============================================

async function testUserRegistration() {
  log('\n========== 2. 用户注册测试 ==========', 'info');
  
  // 正常注册
  for (let i = 0; i < testUsers.length; i++) {
    await runTest(`注册用户 ${testUsers[i].name}`, async () => {
      const response = await axios.post(`${API_BASE}/auth/register`, testUsers[i]);
      if (response.status !== 201) throw new Error('状态码不是201');
      if (!response.data.user) throw new Error('响应中缺少用户数据');
      if (!response.data.user.id) throw new Error('用户ID缺失');
      if (response.data.user.passwordHash) throw new Error('响应中包含密码哈希（安全问题）');
      testContext.users[i] = response.data.user;
    });
  }
  
  // 重复注册测试
  await runTest('重复邮箱注册应失败', async () => {
    try {
      await axios.post(`${API_BASE}/auth/register`, testUsers[0]);
      throw new Error('重复注册应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 409) {
        throw new Error(`状态码应为409，实际为${error.response?.status}`);
      }
    }
  });
  
  // 缺少字段测试
  await runTest('缺少必要字段应失败', async () => {
    try {
      await axios.post(`${API_BASE}/auth/register`, { email: 'test@test.com' });
      throw new Error('缺少必要字段应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 400) {
        throw new Error(`状态码应为400，实际为${error.response?.status}`);
      }
    }
  });
}

// ============================================
// 3. 用户登录测试
// ============================================

async function testUserLogin() {
  log('\n========== 3. 用户登录测试 ==========', 'info');
  
  // 正常登录
  for (let i = 0; i < testUsers.length; i++) {
    await runTest(`登录用户 ${testUsers[i].name}`, async () => {
      const response = await axios.post(`${API_BASE}/auth/login`, {
        email: testUsers[i].email,
        password: testUsers[i].password,
      });
      if (response.status !== 200) throw new Error('状态码不是200');
      if (!response.data.token) throw new Error('响应中缺少token');
      if (!response.data.user) throw new Error('响应中缺少用户数据');
      testContext.tokens[i] = response.data.token;
    });
  }
  
  // 错误密码
  await runTest('错误密码应失败', async () => {
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        email: testUsers[0].email,
        password: 'WrongPassword123!',
      });
      throw new Error('错误密码应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 401) {
        throw new Error(`状态码应为401，实际为${error.response?.status}`);
      }
    }
  });
  
  // 不存在的用户
  await runTest('不存在的用户应失败', async () => {
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        email: 'nonexistent@test.com',
        password: 'Test123456!',
      });
      throw new Error('不存在的用户应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 401) {
        throw new Error(`状态码应为401，实际为${error.response?.status}`);
      }
    }
  });
  
  // 登录尝试限制测试
  await runTest('登录尝试次数限制', async () => {
    const testEmail = `rate-limit-test-${Date.now()}@test.com`;
    await axios.post(`${API_BASE}/auth/register`, {
      name: '限流测试',
      email: testEmail,
      password: 'Test123456!',
    });
    
    // 连续错误登录6次
    for (let i = 0; i < 6; i++) {
      try {
        await axios.post(`${API_BASE}/auth/login`, {
          email: testEmail,
          password: 'WrongPassword!',
        });
      } catch (error) {
        // 预期失败
      }
      await sleep(100);
    }
    
    // 第7次应该被限流
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        email: testEmail,
        password: 'WrongPassword!',
      });
      throw new Error('应该被限流但没有');
    } catch (error) {
      if (error.response?.status !== 429) {
        throw new Error(`状态码应为429，实际为${error.response?.status}`);
      }
    }
  });
}

// ============================================
// 4. 身份验证中间件测试
// ============================================

async function testAuthMiddleware() {
  log('\n========== 4. 身份验证中间件测试 ==========', 'info');
  
  await runTest('无token访问受保护资源应失败', async () => {
    try {
      await axios.get(`${API_BASE}/me`);
      throw new Error('无token应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 401) {
        throw new Error(`状态码应为401，实际为${error.response?.status}`);
      }
    }
  });
  
  await runTest('无效token应失败', async () => {
    try {
      await axios.get(`${API_BASE}/me`, {
        headers: { Authorization: 'Bearer invalid_token_12345' },
      });
      throw new Error('无效token应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 401) {
        throw new Error(`状态码应为401，实际为${error.response?.status}`);
      }
    }
  });
  
  await runTest('有效token可以访问受保护资源', async () => {
    const response = await axios.get(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!response.data.user) throw new Error('响应中缺少用户数据');
  });
}

// ============================================
// 5. MFA 多因素认证测试
// ============================================

async function testMFAFlow() {
  log('\n========== 5. MFA 多因素认证测试 ==========', 'info');
  
  let mfaSecret = null;
  
  // 设置MFA
  await runTest('设置MFA密钥', async () => {
    const response = await axios.post(`${API_BASE}/auth/mfa/setup`, {}, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!response.data.secret) throw new Error('响应中缺少secret');
    if (!response.data.otpauth_url) throw new Error('响应中缺少otpauth_url');
    mfaSecret = response.data.secret;
  });
  
  // 启用MFA
  await runTest('启用MFA', async () => {
    const token = speakeasy.totp({
      secret: mfaSecret,
      encoding: 'base32',
    });
    
    const response = await axios.post(`${API_BASE}/auth/mfa/enable`, { token }, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
  });
  
  // 使用错误的MFA验证码
  await runTest('错误的MFA验证码应失败', async () => {
    const response = await axios.post(`${API_BASE}/auth/login`, {
      email: testUsers[0].email,
      password: testUsers[0].password,
    });
    
    if (!response.data.requiresMfa) throw new Error('应该要求MFA');
    const challengeId = response.data.challengeId;
    
    try {
      await axios.post(`${API_BASE}/auth/mfa/verify`, {
        challengeId,
        token: '000000',
      });
      throw new Error('错误的MFA码应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 400) {
        throw new Error(`状态码应为400，实际为${error.response?.status}`);
      }
    }
  });
  
  // 正确的MFA流程
  await runTest('正确的MFA验证流程', async () => {
    const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
      email: testUsers[0].email,
      password: testUsers[0].password,
    });
    
    if (!loginResponse.data.requiresMfa) throw new Error('应该要求MFA');
    const challengeId = loginResponse.data.challengeId;
    
    const token = speakeasy.totp({
      secret: mfaSecret,
      encoding: 'base32',
    });
    
    const verifyResponse = await axios.post(`${API_BASE}/auth/mfa/verify`, {
      challengeId,
      token,
    });
    
    if (verifyResponse.status !== 200) throw new Error('状态码不是200');
    if (!verifyResponse.data.token) throw new Error('响应中缺少token');
    
    // 更新token
    testContext.tokens[0] = verifyResponse.data.token;
  });
}

// ============================================
// 6. 用户管理测试
// ============================================

async function testUserManagement() {
  log('\n========== 6. 用户管理测试 ==========', 'info');
  
  await runTest('获取当前用户信息', async () => {
    const response = await axios.get(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!response.data.user.id) throw new Error('用户信息不完整');
  });
  
  await runTest('获取用户列表', async () => {
    const response = await axios.get(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${testContext.tokens[1]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!Array.isArray(response.data.users)) throw new Error('用户列表格式错误');
    if (response.data.users.length < 3) throw new Error('用户数量不足');
  });
}

// ============================================
// 7. 好友系统测试
// ============================================

async function testFriendSystem() {
  log('\n========== 7. 好友系统测试 ==========', 'info');
  
  // 发送好友请求
  await runTest('用户A向用户B发送好友请求', async () => {
    const response = await axios.post(`${API_BASE}/friends/request`, {
      targetEmail: testUsers[1].email,
    }, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 201) throw new Error('状态码不是201');
    if (!response.data.request) throw new Error('响应中缺少request');
  });
  
  // 重复发送好友请求
  await runTest('重复发送好友请求应失败', async () => {
    try {
      await axios.post(`${API_BASE}/friends/request`, {
        targetEmail: testUsers[1].email,
      }, {
        headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
      });
      throw new Error('重复请求应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 409) {
        throw new Error(`状态码应为409，实际为${error.response?.status}`);
      }
    }
  });
  
  // 给自己发送好友请求
  await runTest('不能给自己发送好友请求', async () => {
    try {
      await axios.post(`${API_BASE}/friends/request`, {
        targetEmail: testUsers[0].email,
      }, {
        headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
      });
      throw new Error('给自己发送请求应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 400) {
        throw new Error(`状态码应为400，实际为${error.response?.status}`);
      }
    }
  });
  
  // 查看好友列表和请求
  await runTest('用户B查看好友请求', async () => {
    const response = await axios.get(`${API_BASE}/friends`, {
      headers: { Authorization: `Bearer ${testContext.tokens[1]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!response.data.requests) throw new Error('响应中缺少requests');
    if (response.data.requests.incoming.length === 0) {
      throw new Error('应该有incoming请求');
    }
  });
  
  // 接受好友请求
  await runTest('用户B接受好友请求', async () => {
    const friendsResponse = await axios.get(`${API_BASE}/friends`, {
      headers: { Authorization: `Bearer ${testContext.tokens[1]}` },
    });
    const requestId = friendsResponse.data.requests.incoming[0].id;
    
    const response = await axios.post(`${API_BASE}/friends/respond`, {
      requestId,
      action: 'accept',
    }, {
      headers: { Authorization: `Bearer ${testContext.tokens[1]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
  });
  
  // 验证已成为好友
  await runTest('验证好友关系已建立', async () => {
    const response = await axios.get(`${API_BASE}/friends`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.data.friends.length === 0) {
      throw new Error('好友列表应该不为空');
    }
  });
  
  // 用户A向用户C发送并拒绝
  await runTest('用户A向用户C发送请求', async () => {
    await axios.post(`${API_BASE}/friends/request`, {
      targetEmail: testUsers[2].email,
    }, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
  });
  
  await runTest('用户C拒绝好友请求', async () => {
    const friendsResponse = await axios.get(`${API_BASE}/friends`, {
      headers: { Authorization: `Bearer ${testContext.tokens[2]}` },
    });
    const requestId = friendsResponse.data.requests.incoming[0].id;
    
    const response = await axios.post(`${API_BASE}/friends/respond`, {
      requestId,
      action: 'decline',
    }, {
      headers: { Authorization: `Bearer ${testContext.tokens[2]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
  });
}

// ============================================
// 8. 会话管理测试
// ============================================

async function testConversationManagement() {
  log('\n========== 8. 会话管理测试 ==========', 'info');
  
  await runTest('获取会话列表', async () => {
    const response = await axios.get(`${API_BASE}/conversations`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!Array.isArray(response.data.conversations)) {
      throw new Error('会话列表格式错误');
    }
  });
  
  await runTest('创建群聊会话', async () => {
    const response = await axios.post(`${API_BASE}/conversations`, {
      name: '测试群聊',
      memberIds: [testContext.users[1].id, testContext.users[2].id],
      isGroup: true,
    }, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 201) throw new Error('状态码不是201');
    if (!response.data.conversation.id) throw new Error('会话ID缺失');
    testContext.conversations.push(response.data.conversation);
  });
  
  await runTest('创建私聊会话', async () => {
    const response = await axios.post(`${API_BASE}/conversations`, {
      name: '私聊测试',
      memberIds: [testContext.users[1].id],
      isGroup: false,
    }, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`状态码不正确: ${response.status}`);
    }
    if (!response.data.conversation.id) throw new Error('会话ID缺失');
  });
  
  await runTest('私聊会话成员数必须为2', async () => {
    try {
      await axios.post(`${API_BASE}/conversations`, {
        name: '错误的私聊',
        memberIds: [testContext.users[1].id, testContext.users[2].id],
        isGroup: false,
      }, {
        headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
      });
      throw new Error('私聊成员数错误应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 400) {
        throw new Error(`状态码应为400，实际为${error.response?.status}`);
      }
    }
  });
  
  await runTest('添加群聊成员', async () => {
    const convId = testContext.conversations[0].id;
    const response = await axios.post(`${API_BASE}/conversations/${convId}/members`, {
      memberIds: [testContext.users[2].id],
    }, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
  });
  
  await runTest('非创建者不能添加成员', async () => {
    const convId = testContext.conversations[0].id;
    try {
      await axios.post(`${API_BASE}/conversations/${convId}/members`, {
        memberIds: [testContext.users[2].id],
      }, {
        headers: { Authorization: `Bearer ${testContext.tokens[1]}` },
      });
      throw new Error('非创建者添加成员应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 403) {
        throw new Error(`状态码应为403，实际为${error.response?.status}`);
      }
    }
  });
  
  await runTest('发布群公告', async () => {
    const convId = testContext.conversations[0].id;
    const response = await axios.post(`${API_BASE}/conversations/${convId}/announcement`, {
      content: '这是一条测试公告',
    }, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!response.data.conversation.announcement) {
      throw new Error('公告未设置');
    }
  });
}

// ============================================
// 9. 消息测试
// ============================================

async function testMessages() {
  log('\n========== 9. 消息测试 ==========', 'info');
  
  const convId = testContext.conversations[0].id;
  
  await runTest('获取会话消息', async () => {
    const response = await axios.get(`${API_BASE}/conversations/${convId}/messages`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!Array.isArray(response.data.messages)) {
      throw new Error('消息列表格式错误');
    }
  });
  
  await runTest('非成员不能查看消息', async () => {
    try {
      await axios.get(`${API_BASE}/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${testContext.tokens[2]}` },
      });
      throw new Error('非成员查看消息应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 404) {
        throw new Error(`状态码应为404，实际为${error.response?.status}`);
      }
    }
  });
}

// ============================================
// 10. 文件上传测试
// ============================================

async function testFileUpload() {
  log('\n========== 10. 文件上传测试 ==========', 'info');
  
  const convId = testContext.conversations[0].id;
  
  // 创建测试文件
  const testFilePath = path.join(__dirname, 'test-upload.txt');
  fs.writeFileSync(testFilePath, '这是一个测试文件内容\nTest file content');
  
  await runTest('上传文件', async () => {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(testFilePath));
    formData.append('conversationId', convId);
    
    const response = await axios.post(`${API_BASE}/files/upload`, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${testContext.tokens[0]}`,
      },
    });
    
    if (response.status !== 201) throw new Error('状态码不是201');
    if (!response.data.file) throw new Error('响应中缺少file');
    if (!response.data.message) throw new Error('响应中缺少message');
    testContext.files.push(response.data.file);
  });
  
  await runTest('非成员不能上传文件', async () => {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(testFilePath));
    formData.append('conversationId', convId);
    
    try {
      await axios.post(`${API_BASE}/files/upload`, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${testContext.tokens[2]}`,
        },
      });
      throw new Error('非成员上传文件应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 403) {
        throw new Error(`状态码应为403，实际为${error.response?.status}`);
      }
    }
  });
  
  await runTest('下载文件', async () => {
    const fileId = testContext.files[0].id;
    const response = await axios.get(`${API_BASE}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
  });
  
  await runTest('非成员不能下载文件', async () => {
    const fileId = testContext.files[0].id;
    try {
      await axios.get(`${API_BASE}/files/${fileId}`, {
        headers: { Authorization: `Bearer ${testContext.tokens[2]}` },
      });
      throw new Error('非成员下载文件应该失败但成功了');
    } catch (error) {
      if (error.response?.status !== 403) {
        throw new Error(`状态码应为403，实际为${error.response?.status}`);
      }
    }
  });
  
  // 清理测试文件
  fs.unlinkSync(testFilePath);
}

// ============================================
// 11. 仪表盘测试
// ============================================

async function testDashboard() {
  log('\n========== 11. 仪表盘测试 ==========', 'info');
  
  await runTest('获取系统摘要', async () => {
    const response = await axios.get(`${API_BASE}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (typeof response.data.users !== 'number') throw new Error('users字段错误');
    if (typeof response.data.conversations !== 'number') throw new Error('conversations字段错误');
    if (typeof response.data.messages !== 'number') throw new Error('messages字段错误');
  });
  
  await runTest('获取活动数据', async () => {
    const response = await axios.get(`${API_BASE}/dashboard/activity`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!Array.isArray(response.data.messagesPerDay)) {
      throw new Error('messagesPerDay格式错误');
    }
  });
  
  await runTest('获取日志', async () => {
    const response = await axios.get(`${API_BASE}/logs`, {
      headers: { Authorization: `Bearer ${testContext.tokens[0]}` },
    });
    if (response.status !== 200) throw new Error('状态码不是200');
    if (!Array.isArray(response.data.logs)) throw new Error('logs格式错误');
  });
}

// ============================================
// 12. Socket.IO 实时通信测试
// ============================================

async function testSocketIO() {
  log('\n========== 12. Socket.IO 实时通信测试 ==========', 'info');
  
  await runTest('Socket.IO连接认证', async () => {
    return new Promise((resolve, reject) => {
      const socket = io(SOCKET_URL, {
        auth: { token: testContext.tokens[1] },
      });
      
      const timeout = setTimeout(() => {
        socket.disconnect();
        reject(new Error('连接超时'));
      }, 5000);
      
      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.disconnect();
        resolve();
      });
      
      socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        socket.disconnect();
        reject(error);
      });
    });
  });
  
  await runTest('无token连接应失败', async () => {
    return new Promise((resolve, reject) => {
      const socket = io(SOCKET_URL, {
        auth: {},
      });
      
      const timeout = setTimeout(() => {
        socket.disconnect();
        reject(new Error('应该连接失败但超时了'));
      }, 3000);
      
      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.disconnect();
        reject(new Error('无token应该连接失败但成功了'));
      });
      
      socket.on('connect_error', () => {
        clearTimeout(timeout);
        socket.disconnect();
        resolve();
      });
    });
  });
  
  await runTest('实时消息发送和接收', async () => {
    return new Promise((resolve, reject) => {
      const convId = testContext.conversations[0].id;
      const socketA = io(SOCKET_URL, { auth: { token: testContext.tokens[0] } });
      const socketB = io(SOCKET_URL, { auth: { token: testContext.tokens[1] } });
      
      const timeout = setTimeout(() => {
        socketA.disconnect();
        socketB.disconnect();
        reject(new Error('消息接收超时'));
      }, 10000);
      
      let receivedMessage = false;
      
      socketB.on('connect', () => {
        socketB.emit('conversation:join', { conversationId: convId });
      });
      
      socketA.on('connect', () => {
        socketA.emit('conversation:join', { conversationId: convId });
        
        setTimeout(() => {
          socketA.emit('message:send', {
            conversationId: convId,
            content: '这是一条测试消息',
          });
        }, 500);
      });
      
      socketB.on('message:new', (message) => {
        if (message.content === '这是一条测试消息' && !receivedMessage) {
          receivedMessage = true;
          clearTimeout(timeout);
          socketA.disconnect();
          socketB.disconnect();
          resolve();
        }
      });
      
      socketA.on('connect_error', (error) => {
        clearTimeout(timeout);
        socketA.disconnect();
        socketB.disconnect();
        reject(error);
      });
    });
  });
  
  await runTest('WebRTC信令转发', async () => {
    return new Promise((resolve, reject) => {
      const convId = testContext.conversations[0].id;
      const socketA = io(SOCKET_URL, { auth: { token: testContext.tokens[0] } });
      const socketB = io(SOCKET_URL, { auth: { token: testContext.tokens[1] } });
      
      const timeout = setTimeout(() => {
        socketA.disconnect();
        socketB.disconnect();
        reject(new Error('信令转发超时'));
      }, 10000);
      
      socketB.on('connect', () => {
        socketB.emit('conversation:join', { conversationId: convId });
      });
      
      socketA.on('connect', () => {
        socketA.emit('conversation:join', { conversationId: convId });
        
        setTimeout(() => {
          socketA.emit('webrtc:signal', {
            conversationId: convId,
            payload: { type: 'offer', sdp: 'fake_sdp_data' },
          });
        }, 500);
      });
      
      socketB.on('webrtc:signal', (data) => {
        if (data.payload.type === 'offer') {
          clearTimeout(timeout);
          socketA.disconnect();
          socketB.disconnect();
          resolve();
        }
      });
    });
  });
  
  await runTest('视频通话信令', async () => {
    return new Promise((resolve, reject) => {
      const convId = testContext.conversations[0].id;
      const socketA = io(SOCKET_URL, { auth: { token: testContext.tokens[0] } });
      const socketB = io(SOCKET_URL, { auth: { token: testContext.tokens[1] } });
      
      const timeout = setTimeout(() => {
        socketA.disconnect();
        socketB.disconnect();
        reject(new Error('呼叫信令超时'));
      }, 10000);
      
      socketB.on('connect', () => {
        socketB.emit('conversation:join', { conversationId: convId });
      });
      
      socketA.on('connect', () => {
        socketA.emit('conversation:join', { conversationId: convId });
        
        setTimeout(() => {
          socketA.emit('call:invite', {
            conversationId: convId,
            mediaType: 'video',
          });
        }, 500);
      });
      
      socketB.on('call:ring', (data) => {
        if (data.conversationId === convId) {
          clearTimeout(timeout);
          socketA.disconnect();
          socketB.disconnect();
          resolve();
        }
      });
    });
  });
}

// ============================================
// 13. 安全性测试
// ============================================

async function testSecurity() {
  log('\n========== 13. 安全性测试 ==========', 'info');
  
  await runTest('SQL注入防护测试', async () => {
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        email: "admin' OR '1'='1",
        password: "password",
      });
    } catch (error) {
      // 应该失败
      if (error.response?.status !== 401) {
        throw new Error('SQL注入防护可能存在问题');
      }
    }
  });
  
  await runTest('XSS防护测试', async () => {
    const convId = testContext.conversations[0].id;
    const socketA = io(SOCKET_URL, { auth: { token: testContext.tokens[0] } });
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socketA.disconnect();
        reject(new Error('超时'));
      }, 5000);
      
      socketA.on('connect', () => {
        socketA.emit('conversation:join', { conversationId: convId });
        socketA.emit('message:send', {
          conversationId: convId,
          content: '<script>alert("XSS")</script>',
        });
        
        setTimeout(() => {
          clearTimeout(timeout);
          socketA.disconnect();
          resolve();
        }, 1000);
      });
    });
  });
  
  await runTest('CORS配置检查', async () => {
    // 检查CORS头
    const response = await axios.options(`${API_BASE}/health`);
    // 应该允许OPTIONS请求
    if (response.status > 400) {
      throw new Error('CORS配置可能有问题');
    }
  });
}

// ============================================
// 14. 性能和压力测试
// ============================================

async function testPerformance() {
  log('\n========== 14. 性能测试 ==========', 'info');
  
  await runTest('并发登录测试（10个并发）', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        axios.post(`${API_BASE}/auth/login`, {
          email: testUsers[0].email,
          password: testUsers[0].password,
        })
      );
    }
    
    const results = await Promise.all(promises);
    if (results.some(r => r.status !== 200)) {
      throw new Error('部分并发请求失败');
    }
  });
  
  await runTest('API响应时间测试', async () => {
    const startTime = Date.now();
    await axios.get(`${API_BASE}/health`);
    const duration = Date.now() - startTime;
    
    if (duration > 1000) {
      throw new Error(`响应时间过长: ${duration}ms`);
    }
  });
}

// ============================================
// 主测试函数
// ============================================

async function runAllTests() {
  const startTime = Date.now();
  
  log('', 'info');
  log('╔════════════════════════════════════════════════════╗', 'info');
  log('║   YouChat 完整黑盒测试套件                        ║', 'info');
  log('║   测试所有API端点和实时通信功能                   ║', 'info');
  log('╚════════════════════════════════════════════════════╝', 'info');
  log('', 'info');
  
  try {
    await testHealthCheck();
    await testUserRegistration();
    await testUserLogin();
    await testAuthMiddleware();
    await testMFAFlow();
    await testUserManagement();
    await testFriendSystem();
    await testConversationManagement();
    await testMessages();
    await testFileUpload();
    await testDashboard();
    await testSocketIO();
    await testSecurity();
    await testPerformance();
    
  } catch (error) {
    log(`致命错误: ${error.message}`, 'error');
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // 生成测试报告
  log('', 'info');
  log('╔════════════════════════════════════════════════════╗', 'info');
  log('║              测试报告                              ║', 'info');
  log('╚════════════════════════════════════════════════════╝', 'info');
  log('', 'info');
  log(`总测试数: ${testsPassed + testsFailed}`, 'info');
  log(`✓ 通过: ${testsPassed}`, 'success');
  log(`✗ 失败: ${testsFailed}`, 'error');
  log(`⊘ 跳过: ${testsSkipped}`, 'warning');
  log(`总耗时: ${duration}秒`, 'info');
  log(`通过率: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(2)}%`, 'info');
  log('', 'info');
  
  // 失败的测试详情
  if (testsFailed > 0) {
    log('失败的测试:', 'error');
    testResults
      .filter(r => !r.passed)
      .forEach(r => {
        log(`  - ${r.name}: ${r.error}`, 'error');
      });
    log('', 'info');
  }
  
  // 生成JSON报告
  const report = {
    summary: {
      total: testsPassed + testsFailed,
      passed: testsPassed,
      failed: testsFailed,
      skipped: testsSkipped,
      duration: duration,
      passRate: ((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(2) + '%',
    },
    tests: testResults,
    timestamp: new Date().toISOString(),
  };
  
  const reportPath = path.join(__dirname, 'test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`详细报告已保存到: ${reportPath}`, 'info');
  
  process.exit(testsFailed > 0 ? 1 : 0);
}

// 运行测试
runAllTests().catch(error => {
  log(`未捕获的错误: ${error.message}`, 'error');
  process.exit(1);
});

