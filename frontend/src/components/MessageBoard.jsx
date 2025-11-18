import { useState, useRef, useEffect } from 'react';
import { api } from '../api/client.js';

export function MessageBoard({ messages, onSend, onUpload, currentUserId, disabled }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const [downloading, setDownloading] = useState(null);

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

  const handleDownloadFile = async (fileId, fileName) => {
    if (downloading === fileId) return;
    
    try {
      setDownloading(fileId);
      console.log('[MessageBoard] 开始下载文件:', fileId);
      
      // 使用axios下载，会自动携带Authorization header
      const response = await api.get(`/files/${fileId}`, {
        responseType: 'blob', // 重要：设置响应类型为blob
      });
      
      console.log('[MessageBoard] 文件下载成功');
      
      // 创建blob URL并触发下载
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log('[MessageBoard] 文件已保存');
    } catch (error) {
      console.error('[MessageBoard] 文件下载失败:', error);
      alert(error.response?.data?.message || '文件下载失败');
    } finally {
      setDownloading(null);
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
                {msg.type === 'file' ? (
                  <div className="file-message">
                    <div className="file-icon">📎</div>
                    <div className="file-info">
                      <div className="file-name">{msg.content}</div>
                      {msg.fileId && (
                        <button
                          type="button"
                          className="file-download"
                          onClick={() => handleDownloadFile(msg.fileId, msg.content)}
                          disabled={downloading === msg.fileId}
                        >
                          {downloading === msg.fileId ? '⏳ 下载中...' : '📥 点击下载'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  msg.content
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

