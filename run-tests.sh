#!/bin/bash

# YouChat 测试运行脚本

echo "╔════════════════════════════════════════════════════╗"
echo "║   YouChat 黑盒测试套件 - 快速启动                 ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# 检查服务器是否运行
echo "🔍 检查服务器状态..."
if curl -s http://localhost:4000/api/health > /dev/null 2>&1; then
    echo "✅ 后端服务器正在运行"
else
    echo "⚠️  后端服务器未运行"
    echo ""
    echo "请在另一个终端运行以下命令启动服务器："
    echo "  cd /root/YouChat"
    echo "  npm run dev"
    echo ""
    read -p "按Enter继续（如果服务器已在其他终端启动）或Ctrl+C退出..."
fi

# 进入测试目录
cd "$(dirname "$0")/tests" || exit 1

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 安装测试依赖..."
    npm install
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "  🧪 开始执行测试..."
echo "════════════════════════════════════════════════════"
echo ""

# 运行测试
npm test

TEST_EXIT_CODE=$?

echo ""
echo "════════════════════════════════════════════════════"
echo "  📊 生成测试报告..."
echo "════════════════════════════════════════════════════"
echo ""

# 生成HTML报告
npm run report

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✨ 测试完成！"
echo "════════════════════════════════════════════════════"
echo ""
echo "📁 测试报告已生成："
echo "  - JSON: $(pwd)/test-report.json"
echo "  - HTML: $(pwd)/test-report.html"
echo "  - LOG:  $(pwd)/test-output.log"
echo ""
echo "🌐 在浏览器中查看HTML报告："
echo "  file://$(pwd)/test-report.html"
echo ""

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "🎉 所有测试通过！"
else
    echo "⚠️  部分测试失败，请查看报告了解详情"
fi

echo ""
exit $TEST_EXIT_CODE

