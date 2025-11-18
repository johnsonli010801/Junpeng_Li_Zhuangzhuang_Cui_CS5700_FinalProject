#!/usr/bin/env node

/**
 * 视频通话手动测试脚本
 * 模拟两个用户进行视频通话的完整流程
 */

const io = require('socket.io-client');
const axios = require('axios');

const API_BASE = 'http://localhost:4000';
const SOCKET_URL = 'http://localhost:4000';

let testsPassed = 0;
let testsFailed = 0;

function log(message, type = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = {
    info: '📘',
    success: '✅',
    error: '❌',
    warning: '⚠️',
  }[type] || '📘';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testVideoCall() {
  log('========================================', 'info');
  log('开始视频通话端到端测试', 'info');
  log('========================================', 'info');
  console.log('');

  let userA, userB, tokenA, tokenB, socketA, socketB, conversationId;

  try {
    // 步骤1: 注册两个测试用户
    log('步骤1: 注册测试用户', 'info');
    const timestamp = Date.now();
    
    try {
      const resA = await axios.post(`${API_BASE}/api/auth/register`, {
        name: `UserA_${timestamp}`,
        email: `user_a_${timestamp}@test.com`,
        password: 'test123',
      });
      userA = resA.data.user;
      log(`用户A注册成功: ${userA.name}`, 'success');
    } catch (error) {
      log(`用户A注册失败（可能已存在）`, 'warning');
    }

    try {
      const resB = await axios.post(`${API_BASE}/api/auth/register`, {
        name: `UserB_${timestamp}`,
        email: `user_b_${timestamp}@test.com`,
        password: 'test123',
      });
      userB = resB.data.user;
      log(`用户B注册成功: ${userB.name}`, 'success');
    } catch (error) {
      log(`用户B注册失败（可能已存在）`, 'warning');
    }

    await sleep(500);

    // 步骤2: 登录获取token
    log('\n步骤2: 用户登录', 'info');
    const loginA = await axios.post(`${API_BASE}/api/auth/login`, {
      email: `user_a_${timestamp}@test.com`,
      password: 'test123',
    });
    tokenA = loginA.data.token;
    userA = loginA.data.user;
    log(`用户A登录成功`, 'success');

    const loginB = await axios.post(`${API_BASE}/api/auth/login`, {
      email: `user_b_${timestamp}@test.com`,
      password: 'test123',
    });
    tokenB = loginB.data.token;
    userB = loginB.data.user;
    log(`用户B登录成功`, 'success');

    await sleep(500);

    // 步骤3: 创建共同会话
    log('\n步骤3: 创建共同会话', 'info');
    const convRes = await axios.post(
      `${API_BASE}/api/conversations`,
      { name: 'Test Video Room', memberIds: [userB.id], isGroup: true },
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    conversationId = convRes.data.conversation.id;
    log(`会话创建成功: ${conversationId}`, 'success');

    await sleep(500);

    // 步骤4: 建立Socket连接
    log('\n步骤4: 建立WebSocket连接', 'info');
    
    socketA = io(SOCKET_URL, { auth: { token: tokenA } });
    socketB = io(SOCKET_URL, { auth: { token: tokenB } });

    await new Promise((resolve) => {
      let connectedCount = 0;
      socketA.on('connect', () => {
        log(`用户A Socket连接成功`, 'success');
        connectedCount++;
        if (connectedCount === 2) resolve();
      });
      socketB.on('connect', () => {
        log(`用户B Socket连接成功`, 'success');
        connectedCount++;
        if (connectedCount === 2) resolve();
      });
    });

    await sleep(500);

    // 步骤5: 加入会话
    log('\n步骤5: 用户加入会话', 'info');
    
    await new Promise((resolve) => {
      let joinedCount = 0;
      
      socketA.on('conversation:joined', () => {
        log(`用户A加入会话成功`, 'success');
        joinedCount++;
        if (joinedCount === 2) resolve();
      });
      
      socketB.on('conversation:joined', () => {
        log(`用户B加入会话成功`, 'success');
        joinedCount++;
        if (joinedCount === 2) resolve();
      });
      
      socketA.emit('conversation:join', { conversationId });
      socketB.emit('conversation:join', { conversationId });
    });

    await sleep(500);

    // 步骤6: 用户A发起视频通话
    log('\n步骤6: 用户A发起视频通话', 'info');
    
    const callTest = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('测试超时：30秒内未完成'));
      }, 30000);

      let receivedRing = false;
      let receivedAccept = false;
      let receivedOffer = false;
      let receivedAnswer = false;
      let receivedCandidatesA = 0;
      let receivedCandidatesB = 0;

      // 用户B监听来电
      socketB.on('call:ring', ({ conversationId: roomId }) => {
        if (roomId === conversationId) {
          log(`✓ 用户B收到来电通知`, 'success');
          receivedRing = true;
          testsPassed++;
          
          // 延迟1秒后接听
          setTimeout(() => {
            log(`用户B接听电话`, 'info');
            socketB.emit('call:accept', { conversationId });
          }, 1000);
        }
      });

      // 用户A监听接听通知
      socketA.on('call:accept', ({ conversationId: roomId }) => {
        if (roomId === conversationId) {
          log(`✓ 用户A收到接听通知`, 'success');
          receivedAccept = true;
          testsPassed++;
          
          // 发送模拟的offer
          setTimeout(() => {
            log(`用户A发送WebRTC offer`, 'info');
            socketA.emit('webrtc:signal', {
              conversationId,
              payload: {
                type: 'offer',
                sdp: 'v=0\no=- 123456 2 IN IP4 127.0.0.1\ns=-\nt=0 0\na=group:BUNDLE 0\na=msid-semantic: WMS\nm=video 9 UDP/TLS/RTP/SAVPF 96\nc=IN IP4 0.0.0.0\na=rtcp:9 IN IP4 0.0.0.0\na=ice-ufrag:test\na=ice-pwd:testpassword\na=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\na=setup:actpass\na=mid:0\na=sendrecv\na=rtcp-mux\na=rtpmap:96 VP8/90000',
              },
            });
          }, 500);
        }
      });

      // 用户B监听offer
      socketB.on('webrtc:signal', ({ conversationId: roomId, payload }) => {
        if (roomId === conversationId) {
          if (payload.type === 'offer') {
            log(`✓ 用户B收到WebRTC offer`, 'success');
            receivedOffer = true;
            testsPassed++;
            
            // 发送answer
            setTimeout(() => {
              log(`用户B发送WebRTC answer`, 'info');
              socketB.emit('webrtc:signal', {
                conversationId,
                payload: {
                  type: 'answer',
                  sdp: 'v=0\no=- 654321 2 IN IP4 127.0.0.1\ns=-\nt=0 0\na=group:BUNDLE 0\na=msid-semantic: WMS\nm=video 9 UDP/TLS/RTP/SAVPF 96\nc=IN IP4 0.0.0.0\na=rtcp:9 IN IP4 0.0.0.0\na=ice-ufrag:test2\na=ice-pwd:testpassword2\na=fingerprint:sha-256 11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11\na=setup:active\na=mid:0\na=sendrecv\na=rtcp-mux\na=rtpmap:96 VP8/90000',
                },
              });
              
              // 发送ICE candidates
              for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                  socketB.emit('webrtc:signal', {
                    conversationId,
                    payload: {
                      type: 'candidate',
                      candidate: {
                        candidate: `candidate:${i} 1 udp 2130706431 192.168.1.${100+i} 54321 typ host`,
                        sdpMLineIndex: 0,
                        sdpMid: '0',
                      },
                    },
                  });
                }, i * 200);
              }
            }, 500);
          } else if (payload.type === 'candidate') {
            receivedCandidatesB++;
            log(`✓ 用户B收到ICE candidate (${receivedCandidatesB})`, 'success');
          }
        }
      });

      // 用户A监听answer和candidates
      socketA.on('webrtc:signal', ({ conversationId: roomId, payload }) => {
        if (roomId === conversationId) {
          if (payload.type === 'answer') {
            log(`✓ 用户A收到WebRTC answer`, 'success');
            receivedAnswer = true;
            testsPassed++;
            
            // 发送ICE candidates
            for (let i = 0; i < 3; i++) {
              setTimeout(() => {
                socketA.emit('webrtc:signal', {
                  conversationId,
                  payload: {
                    type: 'candidate',
                    candidate: {
                      candidate: `candidate:${i} 1 udp 2130706431 192.168.1.${10+i} 12345 typ host`,
                      sdpMLineIndex: 0,
                      sdpMid: '0',
                    },
                  },
                });
              }, i * 200);
            }
          } else if (payload.type === 'candidate') {
            receivedCandidatesA++;
            log(`✓ 用户A收到ICE candidate (${receivedCandidatesA})`, 'success');
          }
        }
      });

      // 发起呼叫
      log(`用户A发起呼叫`, 'info');
      socketA.emit('call:invite', { conversationId });

      // 检查结果
      setTimeout(() => {
        clearTimeout(timeout);
        
        log('\n========================================', 'info');
        log('测试结果汇总', 'info');
        log('========================================', 'info');
        
        if (receivedRing) {
          log('✓ 来电通知: 通过', 'success');
        } else {
          log('✗ 来电通知: 失败', 'error');
          testsFailed++;
        }
        
        if (receivedAccept) {
          log('✓ 接听通知: 通过', 'success');
        } else {
          log('✗ 接听通知: 失败', 'error');
          testsFailed++;
        }
        
        if (receivedOffer) {
          log('✓ WebRTC Offer: 通过', 'success');
        } else {
          log('✗ WebRTC Offer: 失败', 'error');
          testsFailed++;
        }
        
        if (receivedAnswer) {
          log('✓ WebRTC Answer: 通过', 'success');
        } else {
          log('✗ WebRTC Answer: 失败', 'error');
          testsFailed++;
        }
        
        if (receivedCandidatesA > 0 && receivedCandidatesB > 0) {
          log(`✓ ICE Candidates: 通过 (A收到${receivedCandidatesA}个, B收到${receivedCandidatesB}个)`, 'success');
          testsPassed++;
        } else {
          log(`✗ ICE Candidates: 失败 (A收到${receivedCandidatesA}个, B收到${receivedCandidatesB}个)`, 'error');
          testsFailed++;
        }
        
        resolve();
      }, 5000);
    });

    await callTest;

    // 步骤7: 测试挂断
    log('\n步骤7: 测试挂断功能', 'info');
    
    await new Promise((resolve) => {
      socketB.on('call:end', ({ conversationId: roomId }) => {
        if (roomId === conversationId) {
          log(`✓ 用户B收到挂断通知`, 'success');
          testsPassed++;
          resolve();
        }
      });
      
      log(`用户A挂断电话`, 'info');
      socketA.emit('call:end', { conversationId });
    });

    await sleep(500);

  } catch (error) {
    log(`测试过程中发生错误: ${error.message}`, 'error');
    testsFailed++;
  } finally {
    // 清理
    if (socketA) socketA.disconnect();
    if (socketB) socketB.disconnect();
  }

  // 最终报告
  console.log('\n');
  log('========================================', 'info');
  log('最终测试报告', 'info');
  log('========================================', 'info');
  log(`总计测试: ${testsPassed + testsFailed}`, 'info');
  log(`通过: ${testsPassed}`, 'success');
  log(`失败: ${testsFailed}`, testsFailed > 0 ? 'error' : 'success');
  log('========================================', 'info');
  
  process.exit(testsFailed > 0 ? 1 : 0);
}

// 运行测试
testVideoCall().catch(error => {
  log(`测试运行失败: ${error.message}`, 'error');
  process.exit(1);
});



