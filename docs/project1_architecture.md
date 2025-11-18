Project 1 — 实时安全通讯平台设计
================================

概述
----
目标是实现一个支持文本/语音/视频聊天、文件共享、群组协作、安全登录及活动日志的实时通讯应用。系统分为前端（React + TypeScript）、后端（NestJS + WebSocket + WebRTC 控制）、实时传输层（WebRTC/SFU）以及数据与日志基础设施。

核心特性概览
------------
| # | 需求 | 设计落实 |
|---|------|---------|
| 1 | 即时通讯 | 文本：WebSocket；语音/视频：WebRTC + SFU；消息队列保证送达 |
| 2 | 文件共享 | 直传（P2P）+ 托管（S3 兼容存储）；病毒扫描与加密 |
| 3 | 通讯安全 | TLS、端到端加密（双棘轮）、零知识密钥协商 |
| 4 | 安全登录+MFA | OAuth2/OIDC + TOTP/SMS/WebAuthn 任选；风险感知登录 |
| 5 | 群聊/协作 | 群组服务（成员、角色、权限）、协作文档/白板频道 |
| 6 | 日志/仪表盘 | ELK/OTel 管线，实时连接监控、审计追踪、告警 |
| 7 | 友好前端 | React + Chakra UI + Zustand；响应式布局、无障碍支持 |

系统架构
--------
```
┌──────────────┐         ┌─────────────────────┐
│ React 前端   │  HTTPS  │ API Gateway (NestJS) │
│ Chakra UI    │◀────────┤ GraphQL/REST        │
└──────┬───────┘         └──────┬──────────────┘
       │WebSocket/SSE           │
       ▼                        ▼
┌──────────────┐      ┌────────────────────┐
│ 实时信令服务 │◀────▶│ 会话/群组服务      │
│ (Socket.IO)  │      │ (CQRS, Redis, DB)  │
└──────┬───────┘      └─────────┬──────────┘
       │WebRTC 控制              │
       ▼                        ▼
┌──────────────┐      ┌────────────────────┐
│ SFU/MediaSrv │      │ 文件 & 密钥服务    │
│ (Janus/ion)  │      │ (S3 + KMS)         │
└──────────────┘      └────────────────────┘
            ┌──────────────────────────────┐
            │ 监控/日志 (OTel → ELK/Grafana)│
            └──────────────────────────────┘
```

功能模块
--------
1. **会话与消息服务**
   - 数据模型：用户、设备、对话、消息、附件、群组角色。
   - API：`POST /sessions`, `GET /conversations/:id/messages`, GraphQL 订阅获取实时更新。
   - 消息持久化：PostgreSQL（主数据）+ Redis Stream（实时分发）+ S3（大附件）。

2. **实时信令与媒体**
   - Socket.IO 通道处理文本与信令，WebRTC D/TLS SRTP 承载语音/视频。
   - 采用 SFU（如 LiveKit/ion-sfu）低延迟转发，支持屏幕共享。

3. **文件共享**
   - 上传流程：客户端 → 预签名 URL → 对象存储。
   - 扫描：ClamAV Lambda/微服务扫描后才标记可下载。
   - 访问控制：基于会话权限生成一次性下载 URL。

4. **安全与合规模块**
   - 身份：Keycloak/Ory Hydra 提供 OAuth2 + OIDC。
   - MFA：TOTP、短信、FIDO2，多策略可配置。
   - 消息端到端加密：使用 double ratchet（libs: libsignal）。
   - 零信任：设备指纹 + 异常检测（地理位置/时间）。

5. **群聊与协作**
   - 群组类型：公开、私密、临时协作空间。
   - 功能：邀请/踢出、角色权限、群公告、共享白板（CRDT）。

6. **日志与仪表盘**
   - 采集：OpenTelemetry SDK + Jaeger/Tempo Trace，Prometheus 指标。
   - 仪表盘：Grafana + Kibana，展示在线人数、带宽、失败率。
   - 审计：不可篡改日志（Hash 链 + Object Lock）。

7. **前端体验**
   - 技术：React 18 + Vite + TypeScript + Zustand 状态管理。
   - UI：Chakra UI + Tailwind；深浅色模式。
   - 可用性：键盘导航、ARIA 标签、实时输入指示。
   - 关键界面：登录/MFA、主聊天、群组管理、文件面板、仪表盘。

数据模型与存储
--------------
| 实体 | 存储 | 说明 |
|------|------|------|
| User | PostgreSQL | 基本信息 + MFA 状态 |
| Device | PostgreSQL | 设备公钥、信任等级 |
| Conversation | PostgreSQL | 点对点/群聊类型 |
| Message | PostgreSQL + Redis | 永久历史 + 实时分发 |
| Attachment | S3 + DynamoDB 索引 | 元数据/加密信息 |
| AuditLog | Elasticsearch | 可搜索审计 |

安全流程摘要
-----------
1. 用户访问登录页 → OIDC 授权码流程 → 后端颁发短期访问令牌 + 刷新令牌。
2. 登录后触发 MFA（TOTP/SMS/WebAuthn）确认。
3. 前端为每台设备生成 Curve25519 公私钥；通过安全信道交换 Session Key。
4. 文本消息使用双棘轮算法派生对称密钥；语音/视频依赖 DTLS-SRTP。
5. 文件上传前端以 AES-GCM 加密后上传；密钥通过端到端信封分发。

群聊与权限
----------
- 角色：Owner、Admin、Member、Guest。
- 权限矩阵：邀请成员、移除成员、发布公告、管理文件、开启直播。
- 协作会话：可开启共享笔记/白板频道，采用 Yjs CRDT 维持一致性。

日志与可 observability
----------------------
- 指标：消息吞吐、媒体比特率、连接数、失败率。
- 追踪：用户发送消息 → API → 消息服务 → 推送 → 客户端确认，全链路可查。
- 告警：登录失败暴增、带宽异常、MFA 绕过尝试。

开发与交付计划
--------------
1. Sprint 1：基础框架、认证、文本消息。
2. Sprint 2：文件共享、群聊、活动日志。
3. Sprint 3：语音/视频（WebRTC）、仪表盘。
4. Sprint 4：MFA 强化、端到端加密、性能与安全测试。

测试策略
--------
- 单元：消息服务、群组权限、MFA 验证。
- 集成：WebSocket → 消息持久化 → 推送链路。
- 端到端：登录 + MFA + 群聊 + 文件分享用例。
- 性能：1k 并发聊天、500 并发视频流、TB 级文件上传。

部署建议
--------
- 基础设施：Kubernetes (EKS/GKE)，使用 Istio mTLS。
- CI/CD：GitHub Actions → ArgoCD。
- 秘密管理：Vault/KMS。
- 备份与灾备：跨区域数据库复制，对象存储版本化。



