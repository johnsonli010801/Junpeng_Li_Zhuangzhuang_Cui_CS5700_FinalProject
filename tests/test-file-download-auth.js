#!/usr/bin/env node

/**
 * 测试文件下载认证问题
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

async function testFileDownloadAuth() {
  console.log('\n🔐 测试文件下载认证\n');
  
  // 创建用户
  const timestamp = Date.now();
  const user = {
    name: '测试用户',
    email: `test-${timestamp}@test.com`,
    password: 'Test123456!',
  };
  
  await axios.post(`${API_BASE}/auth/register`, user);
  const loginRes = await axios.post(`${API_BASE}/auth/login`, {
    email: user.email,
    password: user.password,
  });
  const token = loginRes.data.token;
  
  // 创建会话
  const convRes = await axios.post(`${API_BASE}/conversations`, {
    name: '下载测试',
    memberIds: [],
    isGroup: true,
  }, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const conversationId = convRes.data.conversation.id;
  
  // 上传文件
  const testFile = path.join(__dirname, 'auth-test.txt');
  fs.writeFileSync(testFile, '认证测试文件');
  
  const formData = new FormData();
  formData.append('file', fs.createReadStream(testFile));
  formData.append('conversationId', conversationId);
  
  const uploadRes = await axios.post(`${API_BASE}/files/upload`, formData, {
    headers: {
      ...formData.getHeaders(),
      Authorization: `Bearer ${token}`,
    },
  });
  
  const fileId = uploadRes.data.file.id;
  console.log('✅ 文件上传成功，ID:', fileId);
  
  // 测试1: 有token下载（应该成功）
  console.log('\n📥 测试1: 有token下载...');
  try {
    const downloadRes = await axios.get(`${API_BASE}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('✅ 有token下载成功，状态码:', downloadRes.status);
  } catch (error) {
    console.error('❌ 有token下载失败:', error.response?.data);
  }
  
  // 测试2: 无token下载（应该失败）
  console.log('\n🚫 测试2: 无token下载...');
  try {
    await axios.get(`${API_BASE}/files/${fileId}`);
    console.log('❌ 无token下载不应该成功！');
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ 无token下载正确返回401:', error.response.data.message);
    } else {
      console.log('⚠️ 状态码不是401:', error.response?.status);
    }
  }
  
  // 测试3: 错误token下载（应该失败）
  console.log('\n🚫 测试3: 错误token下载...');
  try {
    await axios.get(`${API_BASE}/files/${fileId}`, {
      headers: { Authorization: 'Bearer invalid_token' },
    });
    console.log('❌ 错误token下载不应该成功！');
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ 错误token正确返回401:', error.response.data.message);
    } else {
      console.log('⚠️ 状态码不是401:', error.response?.status);
    }
  }
  
  // 测试4: 其他用户下载（应该失败）
  console.log('\n🚫 测试4: 其他用户下载...');
  const otherUser = {
    name: '其他用户',
    email: `other-${timestamp}@test.com`,
    password: 'Test123456!',
  };
  await axios.post(`${API_BASE}/auth/register`, otherUser);
  const otherLoginRes = await axios.post(`${API_BASE}/auth/login`, {
    email: otherUser.email,
    password: otherUser.password,
  });
  const otherToken = otherLoginRes.data.token;
  
  try {
    await axios.get(`${API_BASE}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    console.log('❌ 其他用户不应该能下载！');
  } catch (error) {
    if (error.response?.status === 403) {
      console.log('✅ 其他用户正确返回403:', error.response.data.message);
    } else {
      console.log('⚠️ 状态码不是403:', error.response?.status);
    }
  }
  
  fs.unlinkSync(testFile);
  
  console.log('\n✨ 测试完成\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('结论：文件下载需要正确的Authorization token');
  console.log('前端解决方案：使用axios下载（自动携带token）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

testFileDownloadAuth().catch(console.error);

