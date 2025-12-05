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
      console.log('[MessageBoard] start downloading file:', fileId);
      const response = await api.get(`/files/${fileId}`, {
        responseType: 'blob',
      });
      
      console.log('[MessageBoard] file downloaded successfully');
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log('[MessageBoard] file saved');
    } catch (error) {
      console.error('[MessageBoard] file download failed:', error);
      alert(error.response?.data?.message || 'File download failed');
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
                          {downloading === msg.fileId ? '⏳ Downloading...' : '📥 Download'}
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
          <div className="empty-hint">Start a conversation</div>
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
          placeholder={disabled ? 'Select a conversation' : 'Type a message...'}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={disabled}>
          Send
        </button>
      </form>
    </div>
  );
}

