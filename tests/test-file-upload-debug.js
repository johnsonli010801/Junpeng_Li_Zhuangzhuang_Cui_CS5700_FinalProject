#!/usr/bin/env node

/**
 * 文件上传调试测试
 */

import axios from 'axios';
import { io } from 'socket.io-client';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'http://localhost:4000/api';
const SOCKET_URL = 'http://localhost:4000';

async function testFileUpload() {
  console.log('\n🧪 开始测试文件上传...\n');
  
  // 1. 创建测试用户
  console.log('1️⃣ 创建测试用户...');
  const timestamp = Date.now();
  const userA = {
    name: '测试用户A',
    email: `test-a-${timestamp}@test.com`,
    password: 'Test123456!',
  };
  
  const registerRes = await axios.post(`${API_BASE}/auth/register`, userA);
  console.log('✅ 用户注册成功:', registerRes.data.user.name);
  
  const loginRes = await axios.post(`${API_BASE}/auth/login`, {
    email: userA.email,
    password: userA.password,
  });
  const token = loginRes.data.token;
  console.log('✅ 用户登录成功\n');
  
  // 2. 创建会话
  console.log('2️⃣ 创建群聊会话...');
  const convRes = await axios.post(`${API_BASE}/conversations`, {
    name: '文件测试群',
    memberIds: [],
    isGroup: true,
  }, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const conversationId = convRes.data.conversation.id;
  console.log('✅ 会话创建成功:', conversationId);
  console.log('   会话成员:', convRes.data.conversation.members);
  console.log('');
  
  // 3. 建立Socket连接
  console.log('3️⃣ 建立Socket连接...');
  const socket = io(SOCKET_URL, {
    auth: { token },
  });
  
  await new Promise((resolve) => {
    socket.on('connect', () => {
      console.log('✅ Socket连接成功:', socket.id);
      resolve();
    });
  });
  
  // 4. 加入会话
  console.log('\n4️⃣ 加入会话...');
  socket.emit('conversation:join', { conversationId });
  
  await new Promise(resolve => {
    socket.on('conversation:joined', () => {
      console.log('✅ 已加入会话');
      resolve();
    });
  });
  
  // 5. 监听消息
  console.log('\n5️⃣ 设置消息监听...');
  let fileMessageReceived = false;
  
  socket.on('message:new', (msg) => {
    console.log('\n📨 收到新消息:');
    console.log('   消息ID:', msg.id);
    console.log('   类型:', msg.type);
    console.log('   内容:', msg.content);
    console.log('   文件ID:', msg.fileId);
    console.log('   发送者:', msg.sender?.name);
    console.log('   完整消息:', JSON.stringify(msg, null, 2));
    
    if (msg.type === 'file') {
      fileMessageReceived = true;
    }
  });
  
  // 6. 上传文件
  console.log('\n6️⃣ 上传测试文件...');
  const testFilePath = path.join(__dirname, 'debug-test-file.txt');
  fs.writeFileSync(testFilePath, '这是一个测试文件的内容\nTest file content');
  
  const formData = new FormData();
  formData.append('file', fs.createReadStream(testFilePath));
  formData.append('conversationId', conversationId);
  
  try {
    const uploadRes = await axios.post(`${API_BASE}/files/upload`, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${token}`,
      },
    });
    
    console.log('✅ 文件上传成功!');
    console.log('   文件ID:', uploadRes.data.file.id);
    console.log('   文件名:', uploadRes.data.file.originalName);
    console.log('   消息ID:', uploadRes.data.message.id);
    console.log('   消息类型:', uploadRes.data.message.type);
    console.log('   消息内容:', uploadRes.data.message.content);
    console.log('   消息fileId:', uploadRes.data.message.fileId);
    
    // 等待Socket消息
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n7️⃣ 验证结果...');
    if (fileMessageReceived) {
      console.log('✅ Socket消息已接收');
    } else {
      console.log('❌ Socket消息未接收！');
    }
    
    // 8. 查询消息列表
    console.log('\n8️⃣ 查询会话消息...');
    const msgsRes = await axios.get(`${API_BASE}/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    console.log('✅ 消息列表:', msgsRes.data.messages.length, '条');
    const fileMsg = msgsRes.data.messages.find(m => m.type === 'file');
    if (fileMsg) {
      console.log('✅ 找到文件消息:');
      console.log('   消息ID:', fileMsg.id);
      console.log('   类型:', fileMsg.type);
      console.log('   内容:', fileMsg.content);
      console.log('   fileId:', fileMsg.fileId);
    } else {
      console.log('❌ 消息列表中未找到文件消息！');
    }
    
    // 9. 测试下载
    if (fileMsg && fileMsg.fileId) {
      console.log('\n9️⃣ 测试文件下载...');
      const downloadRes = await axios.get(`${API_BASE}/files/${fileMsg.fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log('✅ 文件下载成功，状态码:', downloadRes.status);
    }
    
  } catch (error) {
    console.error('\n❌ 错误:', error.response?.data || error.message);
    console.error('   状态码:', error.response?.status);
  } finally {
    fs.unlinkSync(testFilePath);
    socket.disconnect();
  }
  
  console.log('\n✨ 测试完成\n');
}

testFileUpload().catch(console.error);

