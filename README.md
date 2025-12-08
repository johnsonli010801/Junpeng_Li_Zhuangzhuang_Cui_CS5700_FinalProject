Project 1: YouChat Secure Real-time Communication Platform
=================================

This repository implements an end-to-end secure real-time communication application, including a frontend (React + Vite), a backend (Express + Socket.IO + Postgres), and a Docker-based database plus Google-related configurations.

Front End Website:

[fronend](https://dinou.cool/app)

---
Video Demo:

[Youtube](https://youtu.be/rYdpnbcv7Fk)

How to Run
--------------------

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres
docker compose up -d postgres

# 3. Start frontend & backend (default ports: frontend 5173, backend 4000)
npm run dev

# Or start them separately
npm run dev:server   # backend only
npm run dev:web      # frontend only
```

- **Frontend dev URL**: `http://localhost:5173`
- **Backend API base URL**: `http://localhost:4000/api`

---

Architecture
--------

### Frontend

- **Tech stack**: React 18, Vite, React Router, Zustand, Recharts, using `socket.io-client` to connect to the backend.
- **Main pages**:
  - `LoginPage`: registration / login, triggers MFA challenges.
  - `MfaPage`: completes login by entering the 6-digit code received via email.
  - `ChatPage`: WeChat-style three-column layout (sidebar + conversation/contacts list + chat window), supporting friend management, group chat, direct chat, file sending, and video calls.
  - `DashboardPage`: system monitoring and statistics (number of users, conversations, messages, files, online users, message trend chart, log list).
- **State & data flow**:
  - `useAuthStore` maintains auth state (JWT, current user, MFA challenge ID, debug code, etc.).
  - All HTTP requests are wrapped via `frontend/src/api/client.js` and automatically attach the token.
  - Socket connections are managed by `frontend/src/api/socket.js`, subscribing to events like `message:new`, `friends:update`, `conversation:*`, `call:*`, etc.

### Backend

- **Tech stack**: Node.js, Express, Socket.IO, Postgres, JWT, Multer, Winston.
- **Main modules**:
  - `authController`: registration, login, MFA verification, `/api/me` for current user.
  - `friendController`: friend requests, handling approvals/rejections, friend list.
  - `conversationController`: creating conversations / groups, adding members, fetching messages, leaving groups, deleting groups.
  - `fileController`: file upload and download (based on Multer, files stored under the `uploads/` directory).
  - `dashboardController` and `/api/logs`: provide statistics and recent logs for the dashboard.
  - `realtime/socketHandlers`: socket authentication, message broadcasting, friend & conversation events, and WebRTC signaling (e.g. `call:ring`).
  - `services/mfaService`: generate, verify, and periodically clean up MFA challenges.
- **Authentication & authorization**:
  - All protected endpoints use `authMiddleware` to validate JWTs.
  - Socket.IO connections validate tokens during handshake; unauthorized connections are rejected.

### Deployment & Infrastructure (Docker / Database / Google Config)

- **Docker & Postgres**
  - `docker-compose.yml` defines the `postgres` service:
    - Image: `postgres:16`
    - Container name: `youchat-postgres`
    - Port mapping: container `25432` → host `25432`
    - Environment variables:
      - `POSTGRES_DB=youchat`
      - `POSTGRES_USER=youchat`
      - `POSTGRES_PASSWORD=youchat_password`
    - Volume: `youchat-postgres-data:/var/lib/postgresql/data`
  - The backend uses `pg` to connect to Postgres, persisting users, conversations, messages, logs, and file metadata.

- **Google email configuration (for MFA)**
  - Config file: `backend/src/config/googleEmailConfig.js`
  - Uses Gmail SMTP to send MFA verification codes; main fields:
    - `host: 'smtp.gmail.com'`
    - `port: 587`
    - `secure: false`
    - `user` / `pass` / `from`: concrete account and app password (hard-coded for demo, should be provided via environment variables in production).

- **Google STUN (for WebRTC)**
  - Configured in the frontend `VideoCall` component:
    - `stun:stun.l.google.com:19302`
    - `stun:stun1.l.google.com:19302`
  - Used for WebRTC NAT traversal to help P2P audio/video connections.

---

Functional Requirements
---------------

- **Users & authentication**
  - User registration and login.
  - After login, users must complete **multi-factor authentication (MFA)** via email verification code.
  - On successful login, users are redirected to the main app; unauthenticated access to protected routes is redirected to login.

- **Friends & contacts**
  - Search and add friends via email or user ID.
  - Handle friend requests (accept / reject).
  - View friend list and start direct chats from the contacts panel.

- **Conversations & chat**
  - Create group chats, invite friends, and manage group members.
  - Support both group and direct chats; conversation list supports search and filtering.
  - Send text messages and receive messages in real time (Socket.IO).
  - Load and display historical messages in the chat window with scrolling.

- **File sharing**
  - Upload files within conversations (max around 25MB, enforced by backend limit).
  - Show file messages in the message list; users can click to download.

- **Audio/video calling (basic)**
  - Start video calls in direct chat conversations.
  - Use WebRTC + Socket.IO signaling, combined with Google STUN for connectivity checks.

- **Monitoring & auditing**
  - Dashboard shows:
    - Total users, conversations, messages, files, and current online users.
    - Message trend chart aggregated by day.
  - Log panel lists recent connections and key actions for auditing.

---

Non-functional Requirements
-----------------

- **Security**
  - Use **JWT** to authenticate all protected HTTP endpoints and Socket.IO connections.
  - All file upload and download endpoints are protected by `authMiddleware` and require a valid login.
  - Login flow requires a second step via email verification code, which has an expiration time and is periodically cleaned up by the backend.
  - User passwords are stored using `bcryptjs` hashes, never in plaintext.
  - The backend logs key actions using `winston` to support security audits and troubleshooting.

- **Reliability & maintainability**
  - Postgres replaces purely local file storage to improve data reliability and consistency.
  - Database data is persisted via the Docker volume `youchat-postgres-data`.
  - On startup, the app validates and normalizes stored data (e.g. via `ensureUserShape` and default-field initialization).

- **Performance & user experience**
  - Real-time chat and notifications use Socket.IO long connections to ensure low latency.
  - The frontend uses Vite for fast development and efficient bundling.
  - The dashboard uses Recharts to visualize message trends, helping observe system usage and load.

- **Deployability**
  - The database can be started with a single `docker compose up -d postgres` command, simplifying environment setup.
  - Frontend and backend use standard `npm run dev` / `npm run build` / `npm run start` workflows, making it easy to migrate to cloud or container orchestration platforms.

