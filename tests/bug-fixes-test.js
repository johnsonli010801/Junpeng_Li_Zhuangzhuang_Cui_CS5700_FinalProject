#!/usr/bin/env node

/**
 * Bug修复验证测试
 * 针对4个用户报告的问题进行测试
 */

import axios from 'axios';
import { io } from 'socket.io-client';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:4000';

let testsPassed = 0;
let testsFailed = 0;

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

function log(message, type = 'info') {
  const colorMap = { success: colors.green, error: colors.red, info: colors.cyan };
  const color = colorMap[type] || colors.reset;
  console.log(`${color}${message}${colors.reset}`);
}

async function runTest(name, testFn) {
  try {
    await testFn();
    testsPassed++;
    log(`✓ ${name}`, 'success');
  } catch (error) {
    testsFailed++;
    log(`✗ ${name}: ${error.message}`, 'error');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createTestUser(prefix) {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  const email = `${prefix}-${timestamp}-${random}@test.com`;
  
  const registerRes = await axios.post(`${API_BASE}/auth/register`, {
    name: `${prefix}-user`,
    email,
    password: 'Test123456!',
  });
  
  const loginRes = await axios.post(`${API_BASE}/auth/login`, {
    email,
    password: 'Test123456!',
  });
  
  return {
    id: registerRes.data.user.id,
    name: registerRes.data.user.name,
    email,
    password: 'Test123456!',
    token: loginRes.data.token,
  };
}

async function createFriendship(userA, userB) {
  await axios.post(`${API_BASE}/friends/request`, {
    targetUserId: userB.id,
  }, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  
  const friendsRes = await axios.get(`${API_BASE}/friends`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  
  const requestId = friendsRes.data.requests.incoming[0].id;
  
  await axios.post(`${API_BASE}/friends/respond`, {
    requestId,
    action: 'accept',
  }, {
    headers: { Authorization: `Bearer ${userB.token}` },
  });
}

// ============================================
// Bug #1: 消息实时显示
// ============================================

async function testBug1MessageRealtime() {
  log('\n========== Bug #1: 消息实时显示测试 ==========', 'info');
  
  await runTest('发送者能立即看到自己发送的消息', async () => {
    const userA = await createTestUser('msg-realtime-a');
    const userB = await createTestUser('msg-realtime-b');
    await createFriendship(userA, userB);
    
    // 创建私聊
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: userB.name,
      memberIds: [userB.id],
      isGroup: false,
    }, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    
    const convId = conv.data.conversation.id;
    
    return new Promise((resolve, reject) => {
      const socketA = io(SOCKET_URL, { auth: { token: userA.token } });
      
      const timeout = setTimeout(() => {
        socketA.disconnect();
        reject(new Error('超时：发送者未收到消息'));
      }, 5000);
      
      let messageSent = false;
      
      socketA.on('connect', () => {
        socketA.emit('conversation:join', { conversationId: convId });
        
        setTimeout(() => {
          socketA.emit('message:send', {
            conversationId: convId,
            content: 'Bug1测试消息',
          });
          messageSent = true;
        }, 500);
      });
      
      socketA.on('message:new', (msg) => {
        if (msg.content === 'Bug1测试消息' && messageSent) {
          clearTimeout(timeout);
          socketA.disconnect();
          resolve();
        }
      });
      
      socketA.on('error', (error) => {
        clearTimeout(timeout);
        socketA.disconnect();
        reject(new Error(`Socket错误: ${error.message}`));
      });
    });
  });
  
  await runTest('接收者能看到对方发送的消息', async () => {
    const userA = await createTestUser('msg-receive-a');
    const userB = await createTestUser('msg-receive-b');
    await createFriendship(userA, userB);
    
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: userB.name,
      memberIds: [userB.id],
      isGroup: false,
    }, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    
    const convId = conv.data.conversation.id;
    
    return new Promise((resolve, reject) => {
      const socketA = io(SOCKET_URL, { auth: { token: userA.token } });
      const socketB = io(SOCKET_URL, { auth: { token: userB.token } });
      
      const timeout = setTimeout(() => {
        socketA.disconnect();
        socketB.disconnect();
        reject(new Error('超时：接收者未收到消息'));
      }, 5000);
      
      socketB.on('connect', () => {
        socketB.emit('conversation:join', { conversationId: convId });
      });
      
      socketA.on('connect', () => {
        socketA.emit('conversation:join', { conversationId: convId });
        
        setTimeout(() => {
          socketA.emit('message:send', {
            conversationId: convId,
            content: 'A发给B的消息',
          });
        }, 500);
      });
      
      socketB.on('message:new', (msg) => {
        if (msg.content === 'A发给B的消息') {
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
// Bug #2: 文件发送
// ============================================

async function testBug2FileSending() {
  log('\n========== Bug #2: 文件发送功能测试 ==========', 'info');
  
  await runTest('文件上传后双方都能看到', async () => {
    const userA = await createTestUser('file-send-a');
    const userB = await createTestUser('file-send-b');
    await createFriendship(userA, userB);
    
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: userB.name,
      memberIds: [userB.id],
      isGroup: false,
    }, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    
    const convId = conv.data.conversation.id;
    
    return new Promise((resolve, reject) => {
      const socketA = io(SOCKET_URL, { auth: { token: userA.token } });
      const socketB = io(SOCKET_URL, { auth: { token: userB.token } });
      
      const timeout = setTimeout(() => {
        socketA.disconnect();
        socketB.disconnect();
        reject(new Error('超时'));
      }, 8000);
      
      let aReceived = false;
      let bReceived = false;
      
      socketB.on('connect', () => {
        socketB.emit('conversation:join', { conversationId: convId });
      });
      
      socketA.on('connect', async () => {
        socketA.emit('conversation:join', { conversationId: convId });
        
        // A上传文件
        setTimeout(async () => {
          const testFile = path.join(__dirname, 'bug2-test.txt');
          fs.writeFileSync(testFile, 'Bug2测试文件内容');
          
          try {
            const formData = new FormData();
            formData.append('file', fs.createReadStream(testFile));
            formData.append('conversationId', convId);
            
            await axios.post(`${API_BASE}/files/upload`, formData, {
              headers: {
                ...formData.getHeaders(),
                Authorization: `Bearer ${userA.token}`,
              },
            });
            
            fs.unlinkSync(testFile);
          } catch (error) {
            clearTimeout(timeout);
            socketA.disconnect();
            socketB.disconnect();
            fs.unlinkSync(testFile);
            reject(error);
          }
        }, 500);
      });
      
      // A应该收到文件消息
      socketA.on('message:new', (msg) => {
        if (msg.type === 'file') {
          aReceived = true;
          if (aReceived && bReceived) {
            clearTimeout(timeout);
            socketA.disconnect();
            socketB.disconnect();
            resolve();
          }
        }
      });
      
      // B也应该收到文件消息
      socketB.on('message:new', (msg) => {
        if (msg.type === 'file') {
          bReceived = true;
          if (aReceived && bReceived) {
            clearTimeout(timeout);
            socketA.disconnect();
            socketB.disconnect();
            resolve();
          }
        }
      });
    });
  });
  
  await runTest('文件消息包含下载链接', async () => {
    const user = await createTestUser('file-link');
    
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: '文件测试',
      memberIds: [],
      isGroup: true,
    }, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    
    const testFile = path.join(__dirname, 'file-link-test.pdf');
    fs.writeFileSync(testFile, 'PDF content');
    
    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(testFile));
      formData.append('conversationId', conv.data.conversation.id);
      
      const uploadRes = await axios.post(`${API_BASE}/files/upload`, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${user.token}`,
        },
      });
      
      if (!uploadRes.data.file.id) {
        throw new Error('文件ID缺失');
      }
      
      if (!uploadRes.data.message.fileId) {
        throw new Error('消息中的fileId缺失');
      }
      
      // 验证可以下载
      const downloadRes = await axios.get(
        `${API_BASE}/files/${uploadRes.data.file.id}`,
        {
          headers: { Authorization: `Bearer ${user.token}` },
        }
      );
      
      if (downloadRes.status !== 200) {
        throw new Error('文件下载失败');
      }
    } finally {
      fs.unlinkSync(testFile);
    }
  });
}

// ============================================
// Bug #3: 私聊名称显示
// ============================================

async function testBug3PrivateChatName() {
  log('\n========== Bug #3: 私聊名称显示测试 ==========', 'info');
  
  await runTest('私聊会话可以成功创建', async () => {
    const userA = await createTestUser('name-test-a');
    const userB = await createTestUser('name-test-b');
    await createFriendship(userA, userB);
    
    // A创建与B的私聊
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: userB.name,
      memberIds: [userB.id],
      isGroup: false,
    }, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    
    // 验证会话创建成功
    if (!conv.data.conversation.id) {
      throw new Error('私聊会话创建失败');
    }
    
    // 验证成员正确
    if (conv.data.conversation.members.length !== 2) {
      throw new Error('私聊应有2个成员');
    }
    
    if (!conv.data.conversation.members.includes(userA.id) ||
        !conv.data.conversation.members.includes(userB.id)) {
      throw new Error('私聊成员不正确');
    }
    
    // 注意：前端会动态显示对方名字，后端存储的name可能是'私聊'
  });
  
  await runTest('好友接受请求后自动创建的私聊', async () => {
    const userA = await createTestUser('auto-chat-a');
    const userB = await createTestUser('auto-chat-b');
    
    await createFriendship(userA, userB);
    
    // 查询A的会话列表，应该有A-B的私聊
    const convsA = await axios.get(`${API_BASE}/conversations`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    
    const privateChatWithB = convsA.data.conversations.find(c =>
      !c.isGroup && c.members.includes(userB.id)
    );
    
    if (!privateChatWithB) {
      throw new Error('自动创建的私聊会话未找到');
    }
  });
}

// ============================================
// Bug #4: 群组管理
// ============================================

async function testBug4GroupManagement() {
  log('\n========== Bug #4: 群组管理功能测试 ==========', 'info');
  
  // 测试邀请好友进群
  await runTest('群成员可以邀请好友进群', async () => {
    const creator = await createTestUser('group-creator');
    const member = await createTestUser('group-member');
    const friend = await createTestUser('group-friend');
    
    // creator和member是好友
    await createFriendship(creator, member);
    // member和friend是好友
    await createFriendship(member, friend);
    
    // creator创建群聊
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: '测试群',
      memberIds: [member.id],
      isGroup: true,
    }, {
      headers: { Authorization: `Bearer ${creator.token}` },
    });
    
    const convId = conv.data.conversation.id;
    
    // member邀请friend进群
    await axios.post(`${API_BASE}/conversations/${convId}/members`, {
      memberIds: [friend.id],
    }, {
      headers: { Authorization: `Bearer ${member.token}` },
    });
    
    // 验证friend已加入
    const convRes = await axios.get(`${API_BASE}/conversations`, {
      headers: { Authorization: `Bearer ${creator.token}` },
    });
    
    const updatedConv = convRes.data.conversations.find(c => c.id === convId);
    if (!updatedConv.members.includes(friend.id)) {
      throw new Error('好友未被成功添加到群聊');
    }
  });
  
  // 测试普通成员退出
  await runTest('普通成员可以退出群聊', async () => {
    const creator = await createTestUser('leave-creator');
    const member = await createTestUser('leave-member');
    await createFriendship(creator, member);
    
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: '退出测试群',
      memberIds: [member.id],
      isGroup: true,
    }, {
      headers: { Authorization: `Bearer ${creator.token}` },
    });
    
    const convId = conv.data.conversation.id;
    
    // member退出
    await axios.post(`${API_BASE}/conversations/${convId}/leave`, {}, {
      headers: { Authorization: `Bearer ${member.token}` },
    });
    
    // 验证member不再在群里
    const convRes = await axios.get(`${API_BASE}/conversations`, {
      headers: { Authorization: `Bearer ${creator.token}` },
    });
    
    const updatedConv = convRes.data.conversations.find(c => c.id === convId);
    if (updatedConv.members.includes(member.id)) {
      throw new Error('成员退出后仍在群聊中');
    }
  });
  
  // 测试群主退出导致群解散
  await runTest('群主退出后群聊解散', async () => {
    const creator = await createTestUser('dissolve-creator');
    const member = await createTestUser('dissolve-member');
    await createFriendship(creator, member);
    
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: '解散测试群',
      memberIds: [member.id],
      isGroup: true,
    }, {
      headers: { Authorization: `Bearer ${creator.token}` },
    });
    
    const convId = conv.data.conversation.id;
    
    return new Promise((resolve, reject) => {
      const socketMember = io(SOCKET_URL, { auth: { token: member.token } });
      
      const timeout = setTimeout(() => {
        socketMember.disconnect();
        reject(new Error('超时：未收到解散通知'));
      }, 5000);
      
      socketMember.on('connect', async () => {
        socketMember.emit('conversation:join', { conversationId: convId });
        
        // creator退出
        setTimeout(async () => {
          try {
            await axios.post(`${API_BASE}/conversations/${convId}/leave`, {}, {
              headers: { Authorization: `Bearer ${creator.token}` },
            });
          } catch (error) {
            clearTimeout(timeout);
            socketMember.disconnect();
            reject(error);
          }
        }, 500);
      });
      
      socketMember.on('conversation:dissolved', (data) => {
        if (data.conversationId === convId) {
          clearTimeout(timeout);
          socketMember.disconnect();
          
          // 验证群聊已从数据库删除
          axios.get(`${API_BASE}/conversations`, {
            headers: { Authorization: `Bearer ${member.token}` },
          }).then(res => {
            const exists = res.data.conversations.some(c => c.id === convId);
            if (exists) {
              reject(new Error('群聊未被删除'));
            } else {
              resolve();
            }
          }).catch(reject);
        }
      });
    });
  });
  
  // 测试群主删除群聊
  await runTest('群主可以删除群聊', async () => {
    const creator = await createTestUser('delete-creator');
    const member = await createTestUser('delete-member');
    await createFriendship(creator, member);
    
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: '删除测试群',
      memberIds: [member.id],
      isGroup: true,
    }, {
      headers: { Authorization: `Bearer ${creator.token}` },
    });
    
    const convId = conv.data.conversation.id;
    
    return new Promise((resolve, reject) => {
      const socketMember = io(SOCKET_URL, { auth: { token: member.token } });
      
      const timeout = setTimeout(() => {
        socketMember.disconnect();
        reject(new Error('超时'));
      }, 5000);
      
      socketMember.on('connect', async () => {
        socketMember.emit('conversation:join', { conversationId: convId });
        
        setTimeout(async () => {
          try {
            await axios.delete(`${API_BASE}/conversations/${convId}`, {
              headers: { Authorization: `Bearer ${creator.token}` },
            });
          } catch (error) {
            clearTimeout(timeout);
            socketMember.disconnect();
            reject(error);
          }
        }, 500);
      });
      
      socketMember.on('conversation:deleted', (data) => {
        if (data.conversationId === convId) {
          clearTimeout(timeout);
          socketMember.disconnect();
          resolve();
        }
      });
    });
  });
  
  // 测试非群主不能删除
  await runTest('非群主不能删除群聊', async () => {
    const creator = await createTestUser('delete-perm-creator');
    const member = await createTestUser('delete-perm-member');
    await createFriendship(creator, member);
    
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: '权限测试群',
      memberIds: [member.id],
      isGroup: true,
    }, {
      headers: { Authorization: `Bearer ${creator.token}` },
    });
    
    const convId = conv.data.conversation.id;
    
    try {
      await axios.delete(`${API_BASE}/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${member.token}` },
      });
      throw new Error('非群主不应能删除群聊');
    } catch (error) {
      if (error.response?.status !== 403) {
        throw new Error(`应返回403，实际返回${error.response?.status}`);
      }
    }
  });
  
  // 测试私聊不能执行群组操作
  await runTest('私聊不能添加成员', async () => {
    const userA = await createTestUser('private-op-a');
    const userB = await createTestUser('private-op-b');
    const userC = await createTestUser('private-op-c');
    await createFriendship(userA, userB);
    
    const conv = await axios.post(`${API_BASE}/conversations`, {
      name: userB.name,
      memberIds: [userB.id],
      isGroup: false,
    }, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    
    try {
      await axios.post(`${API_BASE}/conversations/${conv.data.conversation.id}/members`, {
        memberIds: [userC.id],
      }, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      throw new Error('私聊不应能添加成员');
    } catch (error) {
      if (error.response?.status !== 400) {
        throw new Error(`应返回400，实际返回${error.response?.status}`);
      }
    }
  });
}

// ============================================
// 主测试函数
// ============================================

async function runAllTests() {
  log('', 'info');
  log('╔══════════════════════════════════════════════════════════╗', 'info');
  log('║        Bug修复验证测试                                   ║', 'info');
  log('║        针对4个用户报告的问题                             ║', 'info');
  log('╚══════════════════════════════════════════════════════════╝', 'info');
  log('', 'info');
  
  try {
    await testBug1MessageRealtime();
    await testBug2FileSending();
    await testBug3PrivateChatName();
    await testBug4GroupManagement();
  } catch (error) {
    log(`致命错误: ${error.message}`, 'error');
  }
  
  log('', 'info');
  log('╔══════════════════════════════════════════════════════════╗', 'info');
  log('║                    测试报告                              ║', 'info');
  log('╚══════════════════════════════════════════════════════════╝', 'info');
  log('', 'info');
  log(`总测试数: ${testsPassed + testsFailed}`, 'info');
  log(`✓ 通过: ${testsPassed}`, 'success');
  log(`✗ 失败: ${testsFailed}`, 'error');
  log(`通过率: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(2)}%`, 'info');
  log('', 'info');
  
  if (testsFailed > 0) {
    log('⚠️  有测试失败，请检查代码修复', 'error');
    process.exit(1);
  } else {
    log('🎉 所有Bug修复验证通过！', 'success');
    process.exit(0);
  }
}

runAllTests().catch(error => {
  log(`未捕获错误: ${error.message}`, 'error');
  process.exit(1);
});

