#!/bin/bash

# YouChat Nginx快速修复脚本
# 用于解决413文件上传错误

echo "╔════════════════════════════════════════════════════════╗"
echo "║   YouChat Nginx 配置修复                              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# 检查是否是root
if [ "$EUID" -ne 0 ]; then 
   echo "⚠️  请使用sudo运行此脚本"
   echo "   sudo bash NGINX_QUICK_FIX.sh"
   exit 1
fi

echo "🔍 检查Nginx配置..."
NGINX_CONF="/etc/nginx/nginx.conf"

if [ ! -f "$NGINX_CONF" ]; then
    echo "❌ Nginx配置文件不存在: $NGINX_CONF"
    exit 1
fi

echo "✅ Nginx配置文件: $NGINX_CONF"
echo ""

# 备份配置
echo "💾 备份配置文件..."
cp $NGINX_CONF ${NGINX_CONF}.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ 备份完成"
echo ""

# 检查是否已有配置
if grep -q "client_max_body_size" $NGINX_CONF; then
    echo "⚠️  配置文件中已存在 client_max_body_size"
    echo "   当前配置："
    grep "client_max_body_size" $NGINX_CONF
    echo ""
    read -p "是否要修改为50M？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sed -i 's/client_max_body_size .*/client_max_body_size 50M;/' $NGINX_CONF
        echo "✅ 已更新为50M"
    fi
else
    echo "➕ 添加 client_max_body_size 50M 到配置..."
    # 在http块中添加
    sed -i '/http {/a \    client_max_body_size 50M;' $NGINX_CONF
    echo "✅ 配置已添加"
fi

echo ""
echo "🧪 测试Nginx配置..."
if nginx -t 2>&1 | grep -q "successful"; then
    echo "✅ Nginx配置测试通过"
    echo ""
    echo "🔄 重启Nginx..."
    systemctl reload nginx
    echo "✅ Nginx已重启"
    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║   ✅ 修复完成！                                       ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""
    echo "现在可以上传最大50MB的文件（包括mp3音频）"
    echo ""
else
    echo "❌ Nginx配置测试失败"
    echo "   正在恢复备份..."
    cp ${NGINX_CONF}.backup.* $NGINX_CONF
    echo "   请手动检查配置"
    exit 1
fi
