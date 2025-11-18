import { useState, useRef, useEffect } from 'react';

export function MessageBoard({ messages, onSend, onUpload, currentUserId, disabled }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      onUpload(file);
      event.target.value = '';
    }
  };

  return (
    <div className="chat-window">
      <div className="message-list" ref={listRef}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.senderId === currentUserId ? 'me' : ''}`}
          >
            <div className="bubble">
              <div className="bubble-content">
                {msg.content}
                {msg.type === 'file' && msg.fileUrl && (
                  <a href={msg.fileUrl} target="_blank" rel="noreferrer">
                    下载文件
                  </a>
                )}
              </div>
              <small>{new Date(msg.createdAt).toLocaleTimeString()}</small>
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="empty-hint">开始聊天吧～</div>
        )}
      </div>
      <form className="composer" onSubmit={handleSend}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          📎
        </button>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileChange}
          disabled={disabled}
        />
        <input
          className="composer-input"
          placeholder={disabled ? '请选择会话' : '发送消息...'}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={disabled}>
          发送
        </button>
      </form>
    </div>
  );
}

