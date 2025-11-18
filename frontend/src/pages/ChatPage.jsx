import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConversationList } from '../components/ConversationList.jsx';
import { MessageBoard } from '../components/MessageBoard.jsx';
import { VideoCall } from '../components/VideoCall.jsx';
import { LogPanel } from '../components/LogPanel.jsx';
import { SecurityPanel } from '../components/SecurityPanel.jsx';
import { ContactsPanel } from '../components/ContactsPanel.jsx';
import { api, API_BASE } from '../api/client.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { connectSocket, disconnectSocket, getSocket } from '../api/socket.js';

function ChatPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const setAuth = useAuthStore((state) => state.setAuth);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [rawMessages, setRawMessages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [setupInfo, setSetupInfo] = useState(null);
  const [users, setUsers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState({
    incoming: [],
    outgoing: [],
  });
  const [socket, setSocket] = useState(null);
  const [activeNav, setActiveNav] = useState('chats');
  const [searchTerm, setSearchTerm] = useState('');
  const [callState, setCallState] = useState({
    mode: null, // 'outgoing' | 'incoming'
    conversationId: null,
    from: null,
  });

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      const [meRes, convRes, userRes, logRes] = await Promise.all([
        api.get('/me'),
        api.get('/conversations'),
        api.get('/users'),
        api.get('/logs'),
      ]);
      setAuth({ token, user: meRes.data.user });
      setConversations(convRes.data.conversations);
      setUsers(userRes.data.users);
      setLogs(logRes.data.logs);
      if (convRes.data.conversations.length && !selectedConversation) {
        setSelectedConversation(convRes.data.conversations[0]);
      }
    };
    load();
    refreshFriends();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token) return;
    const socketConnection = connectSocket(token);
    setSocket(socketConnection);
    return () => {
      disconnectSocket();
    };
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const handleIncoming = (message) => {
      console.log('[ChatPage] 收到新消息:', message);
      if (message.conversationId === selectedConversation?.id) {
        setRawMessages((prev) => {
          // 避免重复添加
          if (prev.some(m => m.id === message.id)) {
            return prev;
          }
          return [...prev, message];
        });
      }
    };
    const handleRing = ({ conversationId, from }) => {
      if (!selectedConversation || conversationId !== selectedConversation.id) {
        const convo = conversations.find((c) => c.id === conversationId);
        if (convo) {
          setSelectedConversation(convo);
        }
      }
      setCallState({ mode: 'incoming', conversationId, from });
    };

    socket.on('message:new', handleIncoming);
    socket.on('call:ring', handleRing);
    return () => {
      socket.off('message:new', handleIncoming);
      socket.off('call:ring', handleRing);
    };
  }, [socket, selectedConversation, conversations]);

  const refreshFriends = useCallback(async () => {
    if (!token) return;
    const { data } = await api.get('/friends');
    setFriends(data.friends);
    setFriendRequests(data.requests);
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const handleFriendUpdate = () => {
      refreshFriends();
    };
    const handleConversationUpdated = async ({ conversation }) => {
      // 刷新会话列表
      const { data } = await api.get('/conversations');
      setConversations(data.conversations);
      
      // 如果当前会话被更新，也更新选中的会话
      if (selectedConversation?.id === conversation.id) {
        const updated = data.conversations.find(c => c.id === conversation.id);
        if (updated) {
          setSelectedConversation(updated);
        }
      }
    };
    const handleConversationDeleted = async ({ conversationId, message }) => {
      alert(message || '群聊已被删除');
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      if (selectedConversation?.id === conversationId) {
        setSelectedConversation(null);
      }
    };
    const handleConversationDissolved = async ({ conversationId, message }) => {
      alert(message || '群聊已解散');
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      if (selectedConversation?.id === conversationId) {
        setSelectedConversation(null);
      }
    };
    
    socket.on('friends:update', handleFriendUpdate);
    socket.on('conversation:updated', handleConversationUpdated);
    socket.on('conversation:deleted', handleConversationDeleted);
    socket.on('conversation:dissolved', handleConversationDissolved);
    
    return () => {
      socket.off('friends:update', handleFriendUpdate);
      socket.off('conversation:updated', handleConversationUpdated);
      socket.off('conversation:deleted', handleConversationDeleted);
      socket.off('conversation:dissolved', handleConversationDissolved);
    };
  }, [socket, refreshFriends, selectedConversation]);

  useEffect(() => {
    if (!selectedConversation) return;
    const fetchMessages = async () => {
      const { data } = await api.get(
        `/conversations/${selectedConversation.id}/messages`
      );
      setRawMessages(data.messages);
      getSocket()?.emit('conversation:join', {
        conversationId: selectedConversation.id,
      });
    };
    fetchMessages();
  }, [selectedConversation]);

  const enrichMessage = useCallback((message) => {
    // 如果消息已经有sender对象（来自Socket），优先使用
    const senderName = message.sender?.name || 
                       message.senderName || 
                       users.find((u) => u.id === message.senderId)?.name || 
                       '系统';
    
    const enriched = {
      ...message,
      senderName,
      fileUrl: message.fileId
        ? `${API_BASE}/files/${message.fileId}`
        : undefined,
    };
    
    // 调试：打印文件消息
    if (message.type === 'file') {
      console.log('[enrichMessage] 文件消息:', {
        id: enriched.id,
        type: enriched.type,
        fileId: enriched.fileId,
        fileUrl: enriched.fileUrl,
        content: enriched.content,
      });
    }
    
    return enriched;
  }, [users]);

  const handleCreateGroup = async () => {
    const name = window.prompt('输入群聊名称');
    if (!name) return;
    const { data } = await api.post('/conversations', { name, isGroup: true });
    setConversations((prev) => [...prev, data.conversation]);
  };

  const handleSendMessage = async (content) => {
    if (!selectedConversation) return;
    getSocket()?.emit('message:send', {
      conversationId: selectedConversation.id,
      content,
    });
  };

  const handleUploadFile = async (file) => {
    if (!selectedConversation) return;
    console.log('[ChatPage] 开始上传文件:', file.name);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('conversationId', selectedConversation.id);
      const { data } = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      console.log('[ChatPage] 文件上传成功:', data);
      console.log('[ChatPage] 文件消息:', data.message);
      console.log('[ChatPage] 文件ID:', data.file.id);
      
      // 文件消息会通过Socket广播，但我们也立即添加到界面
      // 避免等待Socket延迟
      if (data.message) {
        setRawMessages((prev) => {
          if (prev.some(m => m.id === data.message.id)) {
            return prev;
          }
          return [...prev, data.message];
        });
      }
    } catch (error) {
      console.error('[ChatPage] 文件上传失败:', error);
      console.error('[ChatPage] 错误详情:', error.response?.data);
      
      let errorMsg = '文件上传失败';
      if (error.response?.status === 413) {
        errorMsg = '文件太大！请上传小于25MB的文件';
      } else if (error.response?.status === 400) {
        errorMsg = error.response?.data?.message || '文件类型不支持或参数错误';
      } else if (error.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      
      alert(errorMsg);
    }
  };

  const handleSetupMfa = async () => {
    const { data } = await api.post('/auth/mfa/setup');
    setSetupInfo(data);
  };

  const handleEnableMfa = async () => {
    const tokenInput = window.prompt('请输入 6 位验证码');
    if (!tokenInput) return;
    await api.post('/auth/mfa/enable', { token: tokenInput });
    const { data } = await api.get('/me');
    setAuth({ token, user: data.user });
    setSetupInfo(null);
  };

  const handleAddFriend = async () => {
    const value = window.prompt('输入好友邮箱或用户ID');
    if (!value) return;
    try {
      const payload = value.includes('@')
        ? { targetEmail: value }
        : { targetUserId: value };
      await api.post('/friends/request', payload);
      await refreshFriends();
      alert('好友申请已发送');
    } catch (error) {
      alert(error.response?.data?.message || '发送失败');
    }
  };

  const handleRespondFriend = async (requestId, action) => {
    await api.post('/friends/respond', { requestId, action });
    await refreshFriends();
    const { data } = await api.get('/conversations');
    setConversations(data.conversations);
  };

  const handleStartDirectChat = async (friend) => {
    const { data } = await api.post('/conversations', {
      name: friend.name, // 使用好友名称作为会话名
      isGroup: false,
      memberIds: [friend.id],
    });
    setConversations((prev) => {
      const exists = prev.find((c) => c.id === data.conversation.id);
      return exists ? prev : [...prev, data.conversation];
    });
    setSelectedConversation(data.conversation);
    setActiveNav('chats');
  };
  
  // 邀请好友进群
  const handleInviteToGroup = async () => {
    if (!selectedConversation || !selectedConversation.isGroup) return;
    
    // 显示好友列表供选择
    const friendNames = friends.map(f => `${f.name} (${f.email})`).join('\n');
    const input = window.prompt(`选择要邀请的好友（输入邮箱或ID）：\n\n您的好友：\n${friendNames}`);
    if (!input) return;
    
    try {
      // 查找好友
      const friend = friends.find(f => 
        f.email === input || f.id === input || f.name === input
      );
      
      if (!friend) {
        alert('未找到该好友');
        return;
      }
      
      await api.post(`/conversations/${selectedConversation.id}/members`, {
        memberIds: [friend.id],
      });
      
      // 刷新会话列表
      const { data } = await api.get('/conversations');
      setConversations(data.conversations);
      alert(`已邀请 ${friend.name} 进群`);
    } catch (error) {
      alert(error.response?.data?.message || '邀请失败');
    }
  };
  
  // 退出群聊
  const handleLeaveGroup = async () => {
    if (!selectedConversation || !selectedConversation.isGroup) return;
    
    const isCreator = selectedConversation.createdBy === user?.id;
    const confirmMsg = isCreator 
      ? '您是群主，退出后群聊将解散。确认退出？'
      : '确认退出该群聊？';
    
    if (!window.confirm(confirmMsg)) return;
    
    try {
      await api.post(`/conversations/${selectedConversation.id}/leave`);
      
      // 从列表中移除该会话
      setConversations(prev => prev.filter(c => c.id !== selectedConversation.id));
      setSelectedConversation(null);
      alert('已退出群聊');
    } catch (error) {
      alert(error.response?.data?.message || '退出失败');
    }
  };
  
  // 删除群聊（群主）
  const handleDeleteGroup = async () => {
    if (!selectedConversation || !selectedConversation.isGroup) return;
    if (selectedConversation.createdBy !== user?.id) {
      alert('只有群主可以删除群聊');
      return;
    }
    
    if (!window.confirm('确认删除该群聊？此操作不可恢复！')) return;
    
    try {
      await api.delete(`/conversations/${selectedConversation.id}`);
      
      // 从列表中移除该会话
      setConversations(prev => prev.filter(c => c.id !== selectedConversation.id));
      setSelectedConversation(null);
      alert('群聊已删除');
    } catch (error) {
      alert(error.response?.data?.message || '删除失败');
    }
  };

  const displayMessages = useMemo(
    () => rawMessages.map(enrichMessage),
    [rawMessages, enrichMessage]
  );

  // 获取私聊会话的显示名称
  const getConversationDisplayName = useCallback((conv) => {
    if (conv.isGroup) {
      return conv.name;
    }
    
    // 私聊：显示对方的名字
    const otherMemberId = conv.members.find(id => id !== user?.id);
    if (otherMemberId) {
      const otherUser = users.find(u => u.id === otherMemberId) ||
                       friends.find(f => f.id === otherMemberId);
      if (otherUser) {
        return otherUser.name;
      }
    }
    
    return conv.name || '私聊';
  }, [user, users, friends]);
  
  const filteredConversations = useMemo(() => {
    const convsWithNames = conversations.map(c => ({
      ...c,
      displayName: getConversationDisplayName(c),
    }));
    
    if (!searchTerm) return convsWithNames;
    return convsWithNames.filter((c) =>
      c.displayName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, conversations, getConversationDisplayName]);

  const navBadge =
    friendRequests.incoming.length > 0 ? <span className="dot" /> : null;

  return (
    <div className="wechat-shell">
      <aside className="wechat-sidebar">
        <div className="avatar large">{user?.name?.slice(0, 1).toUpperCase()}</div>
        <button
          className={activeNav === 'chats' ? 'active' : ''}
          onClick={() => setActiveNav('chats')}
        >
          聊天
        </button>
        <button
          className={activeNav === 'contacts' ? 'active' : ''}
          onClick={() => setActiveNav('contacts')}
        >
          通讯录
          {navBadge}
        </button>
        <button
          className={activeNav === 'settings' ? 'active' : ''}
          onClick={() => setActiveNav('settings')}
        >
          设置
        </button>
      </aside>

      <section className="wechat-list-pane">
        {activeNav === 'chats' && (
          <ConversationList
            conversations={filteredConversations}
            selectedId={selectedConversation?.id}
            onSelect={setSelectedConversation}
            onCreateGroup={handleCreateGroup}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        )}
        {activeNav === 'contacts' && (
          <ContactsPanel
            friends={friends}
            requests={friendRequests}
            onAddFriend={handleAddFriend}
            onStartChat={handleStartDirectChat}
            onRespondRequest={handleRespondFriend}
          />
        )}
        {activeNav === 'settings' && (
          <div className="settings-pane">
            <SecurityPanel
              user={user}
              setupInfo={setupInfo}
              onSetup={handleSetupMfa}
              onEnable={handleEnableMfa}
            />
            <LogPanel logs={logs} />
          </div>
        )}
      </section>

      <section className="wechat-chat-pane">
        {selectedConversation ? (
          <>
            <div className="chat-header">
              <div>
                <strong>{getConversationDisplayName(selectedConversation)}</strong>
                <small>{selectedConversation.isGroup ? '群聊' : '好友聊天'}</small>
              </div>
              <div className="chat-actions">
                {selectedConversation.isGroup && (
                  <>
                    <button
                      className="icon-btn"
                      onClick={handleInviteToGroup}
                      title="邀请好友进群"
                    >
                      ➕👥
                    </button>
                    <button
                      className="icon-btn"
                      onClick={handleLeaveGroup}
                      title={selectedConversation.createdBy === user?.id ? '删除群聊' : '退出群聊'}
                    >
                      {selectedConversation.createdBy === user?.id ? '🗑️' : '🚪'}
                    </button>
                  </>
                )}
                <button
                  className="icon-btn"
                  onClick={() =>
                    setCallState({
                      mode: 'outgoing',
                      conversationId: selectedConversation.id,
                      from: user,
                    })
                  }
                  title="视频通话"
                >
                  📹
                </button>
              </div>
            </div>
            <MessageBoard
              messages={displayMessages}
              currentUserId={user?.id}
              onSend={handleSendMessage}
              onUpload={handleUploadFile}
              disabled={!selectedConversation}
            />
          </>
        ) : (
          <div className="chat-empty">请选择左侧的聊天或好友</div>
        )}
      </section>

      <VideoCall
        mode={callState.mode}
        onClose={() => setCallState({ mode: null, conversationId: null, from: null })}
        conversationId={callState.conversationId}
        socket={socket}
        userId={user?.id}
        caller={callState.from}
      />
    </div>
  );
}

export default ChatPage;

