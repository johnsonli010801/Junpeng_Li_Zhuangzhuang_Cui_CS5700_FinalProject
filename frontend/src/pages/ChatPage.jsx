import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConversationList } from '../components/ConversationList.jsx';
import { MessageBoard } from '../components/MessageBoard.jsx';
import { VideoCall } from '../components/VideoCall.jsx';
import { LogPanel } from '../components/LogPanel.jsx';
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
    mode: null,
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
  }, [token]); 

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
      console.log('[ChatPage] received new message:', message);
      if (message.conversationId === selectedConversation?.id) {
        setRawMessages((prev) => {
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
      const { data } = await api.get('/conversations');
      setConversations(data.conversations);
      
      if (selectedConversation?.id === conversation.id) {
        const updated = data.conversations.find(c => c.id === conversation.id);
        if (updated) {
          setSelectedConversation(updated);
        }
      }
    };
    const handleConversationDeleted = async ({ conversationId, message }) => {
      alert(message || 'Group chat has been deleted');
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      if (selectedConversation?.id === conversationId) {
        setSelectedConversation(null);
      }
    };
    const handleConversationDissolved = async ({ conversationId, message }) => {
      alert(message || 'Group chat has been dissolved');
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
    const senderName = message.sender?.name || 
                       message.senderName || 
                       users.find((u) => u.id === message.senderId)?.name || 
                       'System';
    
    const enriched = {
      ...message,
      senderName,
      fileUrl: message.fileId
        ? `${API_BASE}/files/${message.fileId}`
        : undefined,
    };
    
    if (message.type === 'file') {
      console.log('[enrichMessage] file message:', {
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
    const name = window.prompt('Enter group name');
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
    console.log('[ChatPage] start uploading file:', file.name);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('conversationId', selectedConversation.id);
      const { data } = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      console.log('[ChatPage] file upload success:', data);
      console.log('[ChatPage] file message:', data.message);
      console.log('[ChatPage] file id:', data.file.id);
      
      if (data.message) {
        setRawMessages((prev) => {
          if (prev.some(m => m.id === data.message.id)) {
            return prev;
          }
          return [...prev, data.message];
        });
      }
    } catch (error) {
      console.error('[ChatPage] file upload failed:', error);
      console.error('[ChatPage] error detail:', error.response?.data);
      
      let errorMsg = 'File upload failed';
      if (error.response?.status === 413) {
        errorMsg = 'File is too large! Please upload a file smaller than 25MB';
      } else if (error.response?.status === 400) {
        errorMsg = error.response?.data?.message || 'Unsupported file type or invalid parameters';
      } else if (error.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      
      alert(errorMsg);
    }
  };

  const handleAddFriend = async () => {
    const value = window.prompt('Enter friend email or user ID');
    if (!value) return;
    try {
      const payload = value.includes('@')
        ? { targetEmail: value }
        : { targetUserId: value };
      await api.post('/friends/request', payload);
      await refreshFriends();
      alert('Friend request sent');
    } catch (error) {
      alert(error.response?.data?.message || 'Request failed');
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
  
  const handleInviteToGroup = async () => {
    if (!selectedConversation || !selectedConversation.isGroup) return;
    
    const friendNames = friends.map(f => `${f.name} (${f.email})`).join('\n');
    const input = window.prompt(`Pick a friend to invite (enter email or ID):\n\nYour friends:\n${friendNames}`);
    if (!input) return;
    
    try {
      const friend = friends.find(f => 
        f.email === input || f.id === input || f.name === input
      );
      
      if (!friend) {
        alert('Friend not found');
        return;
      }
      
      await api.post(`/conversations/${selectedConversation.id}/members`, {
        memberIds: [friend.id],
      });
      
      const { data } = await api.get('/conversations');
      setConversations(data.conversations);
      alert(`Invited ${friend.name} to the group`);
    } catch (error) {
      alert(error.response?.data?.message || 'Invite failed');
    }
  };
  
  const handleLeaveGroup = async () => {
    if (!selectedConversation || !selectedConversation.isGroup) return;
    
    const isCreator = selectedConversation.createdBy === user?.id;
    const confirmMsg = isCreator 
      ? 'You are the owner. Leaving will dissolve this group. Are you sure?'
      : 'Are you sure you want to leave this group?';
    
    if (!window.confirm(confirmMsg)) return;
    
    try {
      await api.post(`/conversations/${selectedConversation.id}/leave`);
      setConversations(prev => prev.filter(c => c.id !== selectedConversation.id));
      setSelectedConversation(null);
      alert('You have left the group');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to leave group');
    }
  };
  
  const handleDeleteGroup = async () => {
    if (!selectedConversation || !selectedConversation.isGroup) return;
    if (selectedConversation.createdBy !== user?.id) {
      alert('Only the group owner can delete the group');
      return;
    }
    
    if (!window.confirm('Are you sure you want to delete this group? This cannot be undone!')) return;
    
    try {
      await api.delete(`/conversations/${selectedConversation.id}`);
      setConversations(prev => prev.filter(c => c.id !== selectedConversation.id));
      setSelectedConversation(null);
      alert('Group chat deleted');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to delete group');
    }
  };

  const displayMessages = useMemo(
    () => rawMessages.map(enrichMessage),
    [rawMessages, enrichMessage]
  );

  const getConversationDisplayName = useCallback((conv) => {
    if (conv.isGroup) {
      return conv.name;
    }
    
    const otherMemberId = conv.members.find(id => id !== user?.id);
    if (otherMemberId) {
      const otherUser = users.find(u => u.id === otherMemberId) ||
                       friends.find(f => f.id === otherMemberId);
      if (otherUser) {
        return otherUser.name;
      }
    }
    
    return conv.name || 'Direct chat';
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
          Chats
        </button>
        <button
          className={activeNav === 'contacts' ? 'active' : ''}
          onClick={() => setActiveNav('contacts')}
        >
          Contacts
          {navBadge}
        </button>
        <button
          className={activeNav === 'settings' ? 'active' : ''}
          onClick={() => setActiveNav('settings')}
        >
          Settings
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
            <div className="empty-hint">View activity logs and system settings on the right</div>
          </div>
        )}
      </section>

      <section className="wechat-chat-pane">
        {activeNav === 'settings' ? (
          <div className="settings-pane">
            <LogPanel logs={logs} />
            <LogPanel logs={logs} />
          </div>
        ) : selectedConversation ? (
          <>
            <div className="chat-header">
              <div>
                <strong>{getConversationDisplayName(selectedConversation)}</strong>
                <small>{selectedConversation.isGroup ? 'Group chat' : 'Direct chat'}</small>
              </div>
              <div className="chat-actions">
                {selectedConversation.isGroup && (
                  <>
                    <button
                      className="btn ghost btn-sm"
                      type="button"
                      onClick={handleInviteToGroup}
                    >
                      Invite
                    </button>
                    {selectedConversation.createdBy === user?.id ? (
                      <button
                        className="btn danger btn-sm"
                        type="button"
                        onClick={handleDeleteGroup}
                      >
                        Delete group
                      </button>
                    ) : (
                      <button
                        className="btn ghost btn-sm"
                        type="button"
                        onClick={handleLeaveGroup}
                      >
                        Leave group
                      </button>
                    )}
                  </>
                )}
                {!selectedConversation.isGroup && (
                  <button
                    className="icon-btn"
                    onClick={() =>
                      setCallState({
                        mode: 'outgoing',
                        conversationId: selectedConversation.id,
                        from: user,
                      })
                    }
                    title="Video call"
                  >
                    📹
                  </button>
                )}
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
          <div className="chat-empty">Select a conversation or friend from the left</div>
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

