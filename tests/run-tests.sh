#!/bin/bash

echo "========================================="
echo "YouChat 端到端测试套件"
echo "========================================="
echo ""

# 检查后端是否运行
echo "检查后端服务..."
if ! curl -s http://localhost:4000/api/health > /dev/null 2>&1; then
    echo "❌ 后端服务未运行，请先启动: npm run dev:server"
    exit 1
fi
echo "✓ 后端服务正常"
echo ""

# 测试1: API 健康检查
echo "测试1: API 健康检查"
HEALTH=$(curl -s http://localhost:4000/api/health)
if echo "$HEALTH" | grep -q "ok"; then
    echo "✓ API 健康检查通过"
else
    echo "✗ API 健康检查失败"
    exit 1
fi
echo ""

# 测试2: 用户注册
echo "测试2: 用户注册"
TIMESTAMP=$(date +%s)
REGISTER_RESULT=$(curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"TestUser_${TIMESTAMP}\",\"email\":\"test_${TIMESTAMP}@test.com\",\"password\":\"test123\"}")

if echo "$REGISTER_RESULT" | grep -q "user"; then
    echo "✓ 用户注册成功"
else
    echo "✗ 用户注册失败: $REGISTER_RESULT"
    exit 1
fi
echo ""

# 测试3: 用户登录
echo "测试3: 用户登录"
LOGIN_RESULT=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"test_${TIMESTAMP}@test.com\",\"password\":\"test123\"}")

TOKEN=$(echo "$LOGIN_RESULT" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$TOKEN" ]; then
    echo "✓ 用户登录成功"
else
    echo "✗ 用户登录失败: $LOGIN_RESULT"
    exit 1
fi
echo ""

# 测试4: 获取用户信息
echo "测试4: 获取用户信息"
ME_RESULT=$(curl -s http://localhost:4000/api/me \
  -H "Authorization: Bearer $TOKEN")

if echo "$ME_RESULT" | grep -q "user"; then
    echo "✓ 获取用户信息成功"
else
    echo "✗ 获取用户信息失败"
    exit 1
fi
echo ""

# 测试5: 创建会话
echo "测试5: 创建会话"
CONV_RESULT=$(curl -s -X POST http://localhost:4000/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test Room\",\"isGroup\":true}")

CONV_ID=$(echo "$CONV_RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$CONV_ID" ]; then
    echo "✓ 创建会话成功 (ID: $CONV_ID)"
else
    echo "✗ 创建会话失败"
    exit 1
fi
echo ""

# 测试6: 获取会话列表
echo "测试6: 获取会话列表"
CONVS_RESULT=$(curl -s http://localhost:4000/api/conversations \
  -H "Authorization: Bearer $TOKEN")

if echo "$CONVS_RESULT" | grep -q "conversations"; then
    echo "✓ 获取会话列表成功"
else
    echo "✗ 获取会话列表失败"
    exit 1
fi
echo ""

echo "========================================="
echo "所有测试通过! ✓"
echo "========================================="

