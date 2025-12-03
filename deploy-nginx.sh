#!/bin/bash
# YouChat Nginx 部署脚本
# 用途：配置 Nginx 让 dinou.cool 域名访问服务

set -e

echo "=========================================="
echo "  YouChat Nginx 部署脚本"
echo "  域名: dinou.cool"
echo "=========================================="
echo ""

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查是否以 root 身份运行
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}错误：请使用 root 身份运行此脚本${NC}"
    echo "使用命令: sudo bash deploy-nginx.sh"
    exit 1
fi

# 1. 检查 Nginx 是否安装
echo -e "${YELLOW}[1/6] 检查 Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    echo "Nginx 未安装，正在安装..."
    apt update
    apt install -y nginx
    echo -e "${GREEN}✓ Nginx 安装完成${NC}"
else
    echo -e "${GREEN}✓ Nginx 已安装${NC}"
fi

# 2. 停止 Nginx（避免配置文件冲突）
echo -e "${YELLOW}[2/6] 停止 Nginx 服务...${NC}"
systemctl stop nginx
echo -e "${GREEN}✓ Nginx 已停止${NC}"

# 3. 备份旧配置（如果存在）
echo -e "${YELLOW}[3/6] 备份旧配置...${NC}"
if [ -f /etc/nginx/sites-enabled/dinou.cool.conf ]; then
    mv /etc/nginx/sites-enabled/dinou.cool.conf /etc/nginx/sites-enabled/dinou.cool.conf.backup.$(date +%Y%m%d_%H%M%S)
    echo -e "${GREEN}✓ 旧配置已备份${NC}"
else
    echo "无需备份（未找到旧配置）"
fi

# 4. 复制新配置
echo -e "${YELLOW}[4/6] 安装新配置...${NC}"
cp /root/YouChat/dinou.cool.conf /etc/nginx/sites-available/dinou.cool.conf
ln -sf /etc/nginx/sites-available/dinou.cool.conf /etc/nginx/sites-enabled/dinou.cool.conf

# 删除默认配置（避免冲突）
if [ -f /etc/nginx/sites-enabled/default ]; then
    rm -f /etc/nginx/sites-enabled/default
    echo "已移除默认配置"
fi

echo -e "${GREEN}✓ 配置文件已安装${NC}"

# 5. 测试配置
echo -e "${YELLOW}[5/6] 测试 Nginx 配置...${NC}"
if nginx -t; then
    echo -e "${GREEN}✓ 配置文件语法正确${NC}"
else
    echo -e "${RED}✗ 配置文件有错误，请检查${NC}"
    exit 1
fi

# 6. 启动 Nginx
echo -e "${YELLOW}[6/6] 启动 Nginx...${NC}"
systemctl start nginx
systemctl enable nginx
echo -e "${GREEN}✓ Nginx 已启动并设置为开机自启${NC}"

echo ""
echo "=========================================="
echo -e "${GREEN}  ✓ 部署完成！${NC}"
echo "=========================================="
echo ""
echo "📋 后续步骤："
echo ""
echo "1. 确保后端服务正在运行："
echo "   cd /root/YouChat/backend"
echo "   npm start"
echo ""
echo "2. 或使用 PM2 守护进程："
echo "   pm2 start /root/YouChat/backend/src/server.js --name youchat-backend"
echo ""
echo "3. 确保域名解析："
echo "   - 登录域名服务商控制台"
echo "   - 添加 A 记录：dinou.cool -> $(curl -s ifconfig.me)"
echo "   - 等待 DNS 传播（可能需要几分钟）"
echo ""
echo "4. 访问网站："
echo "   http://dinou.cool"
echo ""
echo "5. （可选）启用 HTTPS："
echo "   sudo apt install certbot python3-certbot-nginx"
echo "   sudo certbot --nginx -d dinou.cool -d www.dinou.cool"
echo ""
echo "=========================================="

