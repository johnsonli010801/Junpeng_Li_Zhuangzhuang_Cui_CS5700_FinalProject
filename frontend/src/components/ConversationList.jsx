export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onCreateGroup,
  searchTerm,
  onSearchChange,
}) {
  return (
    <div className="chatlist-panel">
      <div className="chatlist-toolbar">
        <input
          className="chatlist-search"
          placeholder="搜索"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <button className="btn ghost" type="button" onClick={onCreateGroup}>
          + 群聊
        </button>
      </div>
      <div className="chatlist-scroll">
        {conversations.map((conv) => (
          <button
            key={conv.id}
            className={`chatlist-item ${selectedId === conv.id ? 'active' : ''}`}
            onClick={() => onSelect(conv)}
          >
            <div className="avatar">
              {conv.isGroup ? '群' : conv.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="chatlist-meta">
              <div className="title-row">
                <strong>{conv.name}</strong>
                <span className="type-tag">{conv.isGroup ? '群聊' : '好友'}</span>
              </div>
              <small>成员 {conv.members.length}</small>
            </div>
          </button>
        ))}
        {conversations.length === 0 && (
          <div className="empty-hint">暂无会话，先去添加好友或创建群聊吧</div>
        )}
      </div>
    </div>
  );
}

