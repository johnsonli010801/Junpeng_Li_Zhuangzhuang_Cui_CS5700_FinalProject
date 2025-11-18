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
      if (message.conversationId === selectedConversation?.id) {
        setRawMessages((prev) => [...prev, message]);
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
    socket.on('friends:update', handleFriendUpdate);
    return () => {
      socket.off('friends:update', handleFriendUpdate);
    };
  }, [socket, refreshFriends]);

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

  const enrichMessage = (message) => {
    const sender = users.find((u) => u.id === message.senderId);
    return {
      ...message,
      senderName: sender?.name || '系统',
      fileUrl: message.fileId
        ? `${API_BASE}/files/${message.fileId}`
        : undefined,
    };
  };

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
    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversationId', selectedConversation.id);
    const { data } = await api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setRawMessages((prev) => [...prev, data.message]);
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
      name: friend.name,
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

  const displayMessages = useMemo(
    () => rawMessages.map(enrichMessage),
    [rawMessages, users]
  );

  const filteredConversations = useMemo(() => {
    if (!searchTerm) return conversations;
    return conversations.filter((c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, conversations]);

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
                <strong>{selectedConversation.name}</strong>
                <small>{selectedConversation.isGroup ? '群聊' : '好友聊天'}</small>
              </div>
              <div className="chat-actions">
                <button
                  className="icon-btn"
                  onClick={() =>
                    setCallState({
                      mode: 'outgoing',
                      conversationId: selectedConversation.id,
                      from: user,
                    })
                  }
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

