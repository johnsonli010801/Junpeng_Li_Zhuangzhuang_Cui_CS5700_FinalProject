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
          placeholder="Search"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <button className="btn ghost" type="button" onClick={onCreateGroup}>
          + New group
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
              {conv.isGroup ? 'G' : conv.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="chatlist-meta">
              <div className="title-row">
                <strong>{conv.displayName || conv.name}</strong>
                <span className="type-tag">{conv.isGroup ? 'Group' : 'Friend'}</span>
              </div>
              <small>Members {conv.members.length}</small>
            </div>
          </button>
        ))}
        {conversations.length === 0 && (
          <div className="empty-hint">No conversations yet. Add friends or create a group.</div>
        )}
      </div>
    </div>
  );
}

