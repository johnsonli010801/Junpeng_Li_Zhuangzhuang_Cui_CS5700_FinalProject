-- YouChat 数据库 Schema
-- PostgreSQL 15+

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret VARCHAR(100),
    roles TEXT[] DEFAULT ARRAY['user'],
    avatar_url TEXT,
    status VARCHAR(20) DEFAULT 'offline',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- 好友关系表
CREATE TABLE IF NOT EXISTS friendships (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
);

CREATE INDEX idx_friendships_user ON friendships(user_id);
CREATE INDEX idx_friendships_friend ON friendships(friend_id);

-- 好友请求表
CREATE TABLE IF NOT EXISTS friend_requests (
    id VARCHAR(50) PRIMARY KEY,
    from_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, declined
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    handled_at TIMESTAMP
);

CREATE INDEX idx_friend_requests_to ON friend_requests(to_id, status);
CREATE INDEX idx_friend_requests_from ON friend_requests(from_id, status);

-- 会话表
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    is_group BOOLEAN DEFAULT TRUE,
    avatar_url TEXT,
    announcement TEXT,
    announcement_by VARCHAR(50) REFERENCES users(id),
    announcement_at TIMESTAMP,
    created_by VARCHAR(50) NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversations_created_by ON conversations(created_by);

-- 会话成员表
CREATE TABLE IF NOT EXISTS conversation_members (
    id VARCHAR(50) PRIMARY KEY,
    conversation_id VARCHAR(50) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member', -- owner, admin, member
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_read_at TIMESTAMP,
    UNIQUE(conversation_id, user_id)
);

CREATE INDEX idx_conv_members_conv ON conversation_members(conversation_id);
CREATE INDEX idx_conv_members_user ON conversation_members(user_id);

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(50) PRIMARY KEY,
    conversation_id VARCHAR(50) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(20) DEFAULT 'text', -- text, file, system, call
    content TEXT,
    file_id VARCHAR(50),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_type ON messages(type);

-- 文件表
CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(50) PRIMARY KEY,
    conversation_id VARCHAR(50) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    uploader_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    original_name VARCHAR(500) NOT NULL,
    stored_name VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100),
    size_bytes BIGINT,
    path TEXT NOT NULL,
    encrypted BOOLEAN DEFAULT FALSE,
    scan_status VARCHAR(20) DEFAULT 'pending', -- pending, clean, infected
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_files_conversation ON files(conversation_id);
CREATE INDEX idx_files_uploader ON files(uploader_id);

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(50) PRIMARY KEY,
    level VARCHAR(20) NOT NULL, -- info, warn, error
    message TEXT NOT NULL,
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    context JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_logs_level ON audit_logs(level);
CREATE INDEX idx_logs_user ON audit_logs(user_id);
CREATE INDEX idx_logs_created ON audit_logs(created_at DESC);

-- 登录尝试表（防暴力破解）
CREATE TABLE IF NOT EXISTS login_attempts (
    id VARCHAR(50) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    success BOOLEAN NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at DESC);

-- 会话表（Session管理）
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 在线状态表
CREATE TABLE IF NOT EXISTS online_status (
    user_id VARCHAR(50) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    socket_ids TEXT[],
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 已读回执表
CREATE TABLE IF NOT EXISTS message_reads (
    id VARCHAR(50) PRIMARY KEY,
    message_id VARCHAR(50) NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id)
);

CREATE INDEX idx_message_reads_message ON message_reads(message_id);
CREATE INDEX idx_message_reads_user ON message_reads(user_id);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 插入默认数据
INSERT INTO conversations (id, name, is_group, created_by, created_at)
VALUES ('general', '班级公共频道', TRUE, 'system', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- 视图：获取会话最新消息
CREATE OR REPLACE VIEW conversation_latest_messages AS
SELECT DISTINCT ON (conversation_id)
    conversation_id,
    id as message_id,
    content,
    created_at
FROM messages
ORDER BY conversation_id, created_at DESC;

-- 视图：用户好友列表（双向）
CREATE OR REPLACE VIEW user_friends AS
SELECT 
    f.user_id,
    u.id as friend_id,
    u.name as friend_name,
    u.email as friend_email,
    u.avatar_url as friend_avatar,
    u.status as friend_status,
    f.created_at as friends_since
FROM friendships f
JOIN users u ON f.friend_id = u.id;

COMMENT ON TABLE users IS '用户账号信息';
COMMENT ON TABLE friendships IS '好友关系（双向）';
COMMENT ON TABLE friend_requests IS '好友申请记录';
COMMENT ON TABLE conversations IS '会话（群聊/私聊）';
COMMENT ON TABLE conversation_members IS '会话成员关系';
COMMENT ON TABLE messages IS '消息记录';
COMMENT ON TABLE files IS '文件元数据';
COMMENT ON TABLE audit_logs IS '系统审计日志';
COMMENT ON TABLE login_attempts IS '登录尝试记录';
COMMENT ON TABLE sessions IS '用户会话令牌';

