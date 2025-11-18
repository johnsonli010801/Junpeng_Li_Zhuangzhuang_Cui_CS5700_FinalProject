export function ContactsPanel({
  friends,
  requests,
  onAddFriend,
  onStartChat,
  onRespondRequest,
}) {
  return (
    <div className="contacts-panel">
      <div className="contacts-toolbar">
        <strong>通讯录</strong>
        <button className="btn primary" type="button" onClick={onAddFriend}>
          添加好友
        </button>
      </div>

      <section>
        <h4>我的好友</h4>
        <div className="contacts-scroll">
          {friends.length === 0 && <p className="empty-hint">还没有好友，先去添加吧</p>}
          {friends.map((friend) => (
            <div key={friend.id} className="contact-item">
              <div className="avatar">{friend.name?.slice(0, 1).toUpperCase()}</div>
              <div className="contact-meta">
                <strong>{friend.name}</strong>
                <small>{friend.email}</small>
              </div>
              <button
                className="btn ghost"
                type="button"
                onClick={() => onStartChat(friend)}
              >
                发起聊天
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4>新的朋友</h4>
        <div className="contacts-scroll">
          {requests.incoming.length === 0 && requests.outgoing.length === 0 && (
            <p className="empty-hint">暂无好友申请</p>
          )}

          {requests.incoming.map((req) => (
            <div key={req.id} className="contact-item">
              <div className="avatar highlight">{req.from?.name?.slice(0, 1).toUpperCase()}</div>
              <div className="contact-meta">
                <strong>{req.from?.name}</strong>
                <small>{req.from?.email}</small>
              </div>
              <div className="action-group">
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => onRespondRequest(req.id, 'accept')}
                >
                  同意
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => onRespondRequest(req.id, 'decline')}
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}

          {requests.outgoing.map((req) => (
            <div key={req.id} className="contact-item pending">
              <div className="avatar">{req.to?.name?.slice(0, 1).toUpperCase()}</div>
              <div className="contact-meta">
                <strong>{req.to?.name}</strong>
                <small>等待对方同意</small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}



