#!/bin/bash
echo "======================================"
echo "🧹 清理缓存并启动 YouChat"
echo "======================================"

# 停止旧进程
echo "⏹️  停止旧服务..."
pkill -f "node.*dev" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# 清理前端缓存
echo "🗑️  清理前端缓存..."
cd frontend
rm -rf node_modules/.vite
rm -rf dist
cd ..

# 清理后端缓存（如果有）
echo "🗑️  清理后端缓存..."
cd backend
rm -rf node_modules/.cache 2>/dev/null || true
cd ..

echo "✅ 缓存清理完成！"
echo ""
echo "======================================"
echo "🚀 启动服务..."
echo "======================================"
echo ""
echo "前端地址: http://localhost:5173"
echo "后端地址: http://localhost:4000"
echo ""
echo "📌 提示: 如果浏览器还是显示旧样式，请："
echo "   1. 按 Ctrl+Shift+R (强制刷新)"
echo "   2. 或者按 F12 打开开发者工具，右键刷新按钮选择'清空缓存并硬性重新加载'"
echo ""
echo "======================================"

# 启动服务
npm run dev
