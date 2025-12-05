#!/bin/bash

OUTPUT_FILE="all-code.txt"

echo "========================================" > $OUTPUT_FILE
echo "YouChat 项目完整代码汇总" >> $OUTPUT_FILE
echo "生成时间: $(date)" >> $OUTPUT_FILE
echo "========================================" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE

# 后端代码
echo "" >> $OUTPUT_FILE
echo "###################################" >> $OUTPUT_FILE
echo "# 后端代码 (Backend)" >> $OUTPUT_FILE
echo "###################################" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE

for file in backend/src/*.js; do
  if [ -f "$file" ]; then
    echo "========================================" >> $OUTPUT_FILE
    echo "文件: $file" >> $OUTPUT_FILE
    echo "========================================" >> $OUTPUT_FILE
    cat "$file" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
  fi
done

# 前端代码
echo "" >> $OUTPUT_FILE
echo "###################################" >> $OUTPUT_FILE
echo "# 前端代码 (Frontend)" >> $OUTPUT_FILE
echo "###################################" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE

# 前端主文件
for file in frontend/src/*.jsx frontend/src/*.js; do
  if [ -f "$file" ]; then
    echo "========================================" >> $OUTPUT_FILE
    echo "文件: $file" >> $OUTPUT_FILE
    echo "========================================" >> $OUTPUT_FILE
    cat "$file" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
  fi
done

# 前端组件
for file in frontend/src/components/*.jsx; do
  if [ -f "$file" ]; then
    echo "========================================" >> $OUTPUT_FILE
    echo "文件: $file" >> $OUTPUT_FILE
    echo "========================================" >> $OUTPUT_FILE
    cat "$file" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
  fi
done

# 前端页面
for file in frontend/src/pages/*.jsx; do
  if [ -f "$file" ]; then
    echo "========================================" >> $OUTPUT_FILE
    echo "文件: $file" >> $OUTPUT_FILE
    echo "========================================" >> $OUTPUT_FILE
    cat "$file" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
  fi
done

# API相关
for file in frontend/src/api/*.js; do
  if [ -f "$file" ]; then
    echo "========================================" >> $OUTPUT_FILE
    echo "文件: $file" >> $OUTPUT_FILE
    echo "========================================" >> $OUTPUT_FILE
    cat "$file" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
  fi
done

# Store
for file in frontend/src/store/*.js; do
  if [ -f "$file" ]; then
    echo "========================================" >> $OUTPUT_FILE
    echo "文件: $file" >> $OUTPUT_FILE
    echo "========================================" >> $OUTPUT_FILE
    cat "$file" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
  fi
done

# 配置文件
echo "" >> $OUTPUT_FILE
echo "###################################" >> $OUTPUT_FILE
echo "# 配置文件 (Configuration)" >> $OUTPUT_FILE
echo "###################################" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE

for file in backend/package.json frontend/package.json package.json; do
  if [ -f "$file" ]; then
    echo "========================================" >> $OUTPUT_FILE
    echo "文件: $file" >> $OUTPUT_FILE
    echo "========================================" >> $OUTPUT_FILE
    cat "$file" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
  fi
done

echo "完成！所有代码已汇总到 $OUTPUT_FILE"
