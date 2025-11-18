Project 1: 实时安全通讯平台
================================

本仓库实现了一个用于课程作业的端到端实时通讯应用，前端 (React + Vite) 与后端 (Express + Socket.IO) 已完整落地，可直接运行体验。

核心特性
--------
1. **即时通讯**：Socket.IO 文本推送、WebRTC 信令与音视频呼叫。
2. **文件共享**：支持 P2P 触发、后端存储加鉴权下载。
3. **通信安全**：所有 API 及 Socket 交互基于 JWT；文件下载需会话授权。
4. **安全登录 + MFA**：支持注册、登录、TOTP 双因素绑定与校验。
5. **好友 + 群聊**：新增类似微信的好友申请/通讯录/私聊入口，保留群聊管理。
6. **活动日志/仪表盘**：后端审计日志 + 前端仪表盘（消息趋势、连接记录）。
7. **友好前端**：模仿微信的三栏布局（侧边导航 + 会话/通讯录 + 聊天窗）与弹窗式视频通话体验。

快速开始
--------
```bash
# 1. 安装依赖（启用 workspace）
npm install

# 2. 启动前后端（默认端口：前端 5173，后端 4000）
npm run dev

# 独立启动
npm run dev:server   # 仅后端
npm run dev:web      # 仅前端
```

- 默认 API 地址：`http://localhost:4000/api`
- 前端开发地址：`http://localhost:5173`
- 可通过 `.env` 为前后端分别配置 `PORT`、`VITE_API_BASE`、`VITE_SOCKET_URL`。

代码结构
--------
```
backend/   # Express + Socket.IO + LowDB（用户/会话/日志/文件）
frontend/  # React 18 + Vite + Zustand + Recharts（聊天 & 仪表盘）
docs/      # 架构与实现说明
uploads/   # 文件上传目录（自动创建，生产可替换为对象存储）
```

更多设计细节（模块划分、数据流、安全策略、测试/部署计划）见 `docs/project1_architecture.md`。

