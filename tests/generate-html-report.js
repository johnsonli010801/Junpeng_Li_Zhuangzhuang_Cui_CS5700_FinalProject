#!/usr/bin/env node

/**
 * 生成HTML格式的测试报告
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const reportPath = path.join(__dirname, 'test-report.json');
const outputPath = path.join(__dirname, 'test-report.html');

if (!fs.existsSync(reportPath)) {
  console.error('❌ 测试报告文件不存在，请先运行测试: npm test');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouChat 测试报告</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 2rem;
      min-height: 100vh;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      background: white;
      border-radius: 16px;
      padding: 2rem;
      margin-bottom: 2rem;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    }
    
    .header h1 {
      font-size: 2.5rem;
      color: #2d3748;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .header .subtitle {
      color: #718096;
      font-size: 1rem;
    }
    
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .stat-card {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s;
    }
    
    .stat-card:hover {
      transform: translateY(-4px);
    }
    
    .stat-card .label {
      color: #718096;
      font-size: 0.875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
    }
    
    .stat-card .value {
      font-size: 2.5rem;
      font-weight: 700;
      color: #2d3748;
    }
    
    .stat-card.passed .value { color: #48bb78; }
    .stat-card.failed .value { color: #f56565; }
    .stat-card.duration .value { font-size: 2rem; }
    
    .progress-bar {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    }
    
    .progress-bar h3 {
      margin-bottom: 1rem;
      color: #2d3748;
    }
    
    .progress-track {
      height: 40px;
      background: #e2e8f0;
      border-radius: 20px;
      overflow: hidden;
      position: relative;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #48bb78, #38a169);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      transition: width 1s ease;
    }
    
    .tests-list {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    }
    
    .tests-list h3 {
      margin-bottom: 1rem;
      color: #2d3748;
    }
    
    .test-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem;
      border-bottom: 1px solid #e2e8f0;
      transition: background 0.2s;
    }
    
    .test-item:hover {
      background: #f7fafc;
    }
    
    .test-item:last-child {
      border-bottom: none;
    }
    
    .test-name {
      flex: 1;
      color: #2d3748;
    }
    
    .test-status {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.875rem;
      font-weight: 600;
      margin-right: 1rem;
    }
    
    .test-status.passed {
      background: #c6f6d5;
      color: #22543d;
    }
    
    .test-status.failed {
      background: #fed7d7;
      color: #742a2a;
    }
    
    .test-duration {
      color: #718096;
      font-size: 0.875rem;
    }
    
    .error-message {
      color: #e53e3e;
      font-size: 0.875rem;
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: #fff5f5;
      border-radius: 6px;
    }
    
    .filter-buttons {
      margin-bottom: 1rem;
      display: flex;
      gap: 0.5rem;
    }
    
    .filter-btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 8px;
      background: #e2e8f0;
      color: #2d3748;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .filter-btn:hover {
      background: #cbd5e0;
    }
    
    .filter-btn.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    
    .footer {
      text-align: center;
      color: white;
      margin-top: 2rem;
      padding: 1rem;
    }
    
    @media (max-width: 768px) {
      body {
        padding: 1rem;
      }
      
      .header h1 {
        font-size: 1.75rem;
      }
      
      .summary {
        grid-template-columns: repeat(2, 1fr);
      }
      
      .stat-card .value {
        font-size: 2rem;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🧪 YouChat 测试报告</h1>
      <p class="subtitle">生成时间: ${report.timestamp}</p>
    </div>
    
    <div class="summary">
      <div class="stat-card">
        <div class="label">总测试数</div>
        <div class="value">${report.summary.total}</div>
      </div>
      <div class="stat-card passed">
        <div class="label">✓ 通过</div>
        <div class="value">${report.summary.passed}</div>
      </div>
      <div class="stat-card failed">
        <div class="label">✗ 失败</div>
        <div class="value">${report.summary.failed}</div>
      </div>
      <div class="stat-card duration">
        <div class="label">总耗时</div>
        <div class="value">${report.summary.duration}s</div>
      </div>
    </div>
    
    <div class="progress-bar">
      <h3>通过率</h3>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${report.summary.passRate}">
          ${report.summary.passRate}
        </div>
      </div>
    </div>
    
    <div class="tests-list">
      <h3>测试详情</h3>
      <div class="filter-buttons">
        <button class="filter-btn active" onclick="filterTests('all')">全部</button>
        <button class="filter-btn" onclick="filterTests('passed')">仅通过</button>
        <button class="filter-btn" onclick="filterTests('failed')">仅失败</button>
      </div>
      <div id="tests-container">
        ${report.tests.map(test => `
          <div class="test-item ${test.passed ? 'passed' : 'failed'}" data-status="${test.passed ? 'passed' : 'failed'}">
            <div class="test-name">
              ${test.name}
              ${test.error ? `<div class="error-message">❌ ${test.error}</div>` : ''}
            </div>
            <span class="test-status ${test.passed ? 'passed' : 'failed'}">
              ${test.passed ? '✓ 通过' : '✗ 失败'}
            </span>
            <span class="test-duration">${test.duration}ms</span>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="footer">
      <p>YouChat 实时安全通讯平台 © 2025</p>
    </div>
  </div>
  
  <script>
    function filterTests(filter) {
      const buttons = document.querySelectorAll('.filter-btn');
      const tests = document.querySelectorAll('.test-item');
      
      buttons.forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      
      tests.forEach(test => {
        if (filter === 'all') {
          test.style.display = 'flex';
        } else {
          test.style.display = test.dataset.status === filter ? 'flex' : 'none';
        }
      });
    }
    
    // 动画效果
    window.addEventListener('load', () => {
      const progressFill = document.querySelector('.progress-fill');
      progressFill.style.width = '0%';
      setTimeout(() => {
        progressFill.style.width = '${report.summary.passRate}';
      }, 100);
    });
  </script>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);
console.log(`✅ HTML报告已生成: ${outputPath}`);
console.log(`📊 在浏览器中打开查看: file://${outputPath}`);

