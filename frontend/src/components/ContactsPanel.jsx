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
        <strong>Contacts</strong>
        <button className="btn primary" type="button" onClick={onAddFriend}>
          Add friend
        </button>
      </div>

      <section>
        <h4>My friends</h4>
        <div className="contacts-scroll">
          {friends.length === 0 && <p className="empty-hint">No friends yet. Try adding some.</p>}
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
                Start chat
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4>New friends</h4>
        <div className="contacts-scroll">
          {requests.incoming.length === 0 && requests.outgoing.length === 0 && (
            <p className="empty-hint">No friend requests</p>
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
                  Accept
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => onRespondRequest(req.id, 'decline')}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}

          {requests.outgoing.map((req) => (
            <div key={req.id} className="contact-item pending">
              <div className="avatar">{req.to?.name?.slice(0, 1).toUpperCase()}</div>
              <div className="contact-meta">
                <strong>{req.to?.name}</strong>
                <small>Waiting for approval</small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}



