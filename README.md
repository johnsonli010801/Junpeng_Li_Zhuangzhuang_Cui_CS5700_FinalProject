Project 1：实时安全通讯平台Youchat
=================================

本仓库实现了一个端到端实时安全通讯应用，包括前端（React + Vite）、后端（Express + Socket.IO + Postgres）以及基于 Docker 的数据库与 Google 相关配置。

---

运行方式
--------------------

```bash
# 1. 安装依赖
npm install

# 2. 启动 Postgres
docker compose up -d postgres

# 3. 启动前后端（默认端口：前端 5173，后端 4000）
npm run dev

# 也可以分别启动
npm run dev:server   # 仅后端
npm run dev:web      # 仅前端
```

- **前端开发地址**：`http://localhost:5173`
- **后端 API 基址**：`http://localhost:4000/api`

---

项目架构
--------

### 前端

- **技术栈**：React 18、Vite、React Router、Zustand、Recharts，使用 `socket.io-client` 连接后端。
- **主要页面**：
  - `LoginPage`：注册 / 登录，发起 MFA 挑战。
  - `MfaPage`：输入邮箱收到的 6 位验证码完成登录。
  - `ChatPage`：微信风格三栏布局（侧边导航 + 会话/通讯录 + 聊天窗口），支持好友管理、群聊、私聊、文件发送、视频通话。
  - `DashboardPage`：系统监控与统计（用户数、会话数、消息数、文件数、在线人数，消息趋势图，日志列表）。
- **状态与数据流**：
  - 使用 `useAuthStore` 维护登录态（JWT、当前用户、MFA 挑战 ID、调试验证码等）。
  - 所有 HTTP 请求通过 `frontend/src/api/client.js` 统一封装，自动携带 Token。
  - Socket 连接通过 `frontend/src/api/socket.js` 管理，订阅 `message:new`、`friends:update`、`conversation:*`、`call:*` 等事件。

### 后端

- **技术栈**：Node.js、Express、Socket.IO、Postgres、JWT、Multer、Winston。
- **主要模块**：
  - `authController`：注册、登录、MFA 验证、`/api/me` 当前用户。
  - `friendController`：好友申请、好友请求处理、好友列表。
  - `conversationController`：会话 / 群组创建、成员添加、获取消息、退出群组、删除群组。
  - `fileController`：文件上传与下载（基于 Multer，文件保存在 `uploads/` 目录）。
  - `dashboardController` 与 `/api/logs`：为仪表盘提供统计数据和最近日志。
  - `realtime/socketHandlers`：Socket 身份认证、消息推送、好友与会话事件推送、WebRTC 信令（如 `call:ring`）。
  - `services/mfaService`：MFA 挑战生成、校验与定时清理。
- **认证与鉴权**：
  - 所有受保护接口使用 `authMiddleware` 校验 JWT。
  - Socket.IO 连接在握手阶段校验 Token，未授权的连接会被拒绝。

### 部署与基础设施（Docker / 数据库 / Google 配置）

- **Docker & Postgres**
  - `docker-compose.yml` 中定义 `postgres` 服务：
    - 镜像：`postgres:16`
    - 容器名：`youchat-postgres`
    - 端口映射：容器 `25432` → 宿主机 `25432`
    - 环境变量：
      - `POSTGRES_DB=youchat`
      - `POSTGRES_USER=youchat`
      - `POSTGRES_PASSWORD=youchat_password`
    - 数据卷：`youchat-postgres-data:/var/lib/postgresql/data`
  - 后端使用 `pg` 连接 Postgres，持久化用户、会话、消息、日志、文件元数据等。

- **Google 邮件配置（用于 MFA）**
  - 配置文件：`backend/src/config/googleEmailConfig.js`
  - 使用 Gmail SMTP 发送 MFA 验证码邮件，主要字段：
    - `host: 'smtp.gmail.com'`
    - `port: 587`
    - `secure: false`
    - `user` / `pass` / `from`：具体账号与应用密码（演示环境写死，生产应使用环境变量）。

- **Google STUN（用于 WebRTC）**
  - 前端 `VideoCall` 组件中配置：
    - `stun:stun.l.google.com:19302`
    - `stun:stun1.l.google.com:19302`
  - 用于 WebRTC 打洞，协助 P2P 音视频连接。

---

功能需求
---------------

- **用户与认证**
  - 用户注册 / 登录。
  - 登录后需要通过邮箱验证码完成 **多因素认证（MFA）**。
  - 登录成功后跳转到应用主界面，未登录访问受保护路由会被重定向。

- **好友与通讯录**
  - 通过邮箱或用户 ID 搜索并添加好友。
  - 处理好友请求（同意 / 拒绝）。
  - 查看好友列表，从通讯录一键发起私聊。

- **会话 / 聊天**
  - 创建群聊，邀请好友加入，管理群成员。
  - 支持群聊和私聊，会话列表支持搜索过滤。
  - 发送文本消息，实时接收对方消息（Socket.IO）。
  - 加载历史聊天记录并在聊天窗口中滚动展示。

- **文件共享**
  - 在会话中上传文件（最大约 25MB，后端有大小限制）。
  - 在消息列表中展示文件消息，点击可下载文件。

- **音视频通话（基础）**
  - 在私聊会话中发起视频通话。
  - 使用 WebRTC + Socket.IO 信令，结合 Google STUN 进行连通性探索。

- **系统监控与审计**
  - 仪表盘展示：
    - 用户总数、会话总数、消息总数、文件总数、当前在线用户数。
    - 按天统计的消息趋势图。
  - 日志面板展示最近的连接与关键操作日志，用于审计。

---

非功能需求
-----------------

- **安全性**
  - 使用 **JWT** 对所有受保护 HTTP 接口与 Socket.IO 连接进行认证。
  - 所有文件上传与下载接口都需要通过 `authMiddleware` 校验登录状态。
  - 登录流程要求通过邮箱验证码进行第二步验证，验证码具有有效期，后台定期清理过期挑战。
  - 用户密码使用 `bcryptjs` 哈希存储，不以明文落库。
  - 后端通过 `winston` 记录关键操作日志，便于安全审计和问题追踪。

- **可靠性与可维护性**
  - 引入 Postgres 替代单纯的本地文件存储，提高数据可靠性与一致性。
  - 通过 Docker volume `youchat-postgres-data` 持久化数据库数据。
  - 应用启动时会进行数据结构校验和迁移（如 `ensureUserShape`、初始化默认字段）。

- **性能与用户体验**
  - 即时通讯与通知使用 Socket.IO 长连接，确保低延迟推送。
  - 前端使用 Vite 提供快速开发体验与高效打包。
  - 仪表盘使用 Recharts 可视化消息趋势，方便观察系统使用情况与负载。

- **可部署性**
  - 数据库通过 `docker compose up -d postgres` 一键拉起，简化环境准备。
  - 前后端使用标准的 `npm run dev` / `npm run build` / `npm run start` 流程，易于迁移到云环境或容器编排平台。


