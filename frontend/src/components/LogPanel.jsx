export function LogPanel({ logs }) {
  const getLevelBadge = (level) => {
    const badges = {
      info: { text: 'INFO', className: 'log-level info', icon: 'ℹ️' },
      warn: { text: 'WARN', className: 'log-level warn', icon: '⚠️' },
      error: { text: 'ERROR', className: 'log-level error', icon: '❌' },
    };
    return badges[level] || badges.info;
  };

  return (
    <div className="panel">
      <h2 style={{ marginBottom: 'var(--spacing-lg)' }}>📋 Activity log</h2>
      <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {logs.length === 0 ? (
          <div className="empty-hint">No log entries yet</div>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th style={{ width: '180px' }}>Time</th>
                <th style={{ width: '100px' }}>Level</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const badge = getLevelBadge(log.level);
                return (
                  <tr key={log.id}>
                    <td style={{ fontSize: '0.8125rem' }}>
                      {new Date(log.timestamp).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td>
                      <span className={badge.className}>
                        {badge.icon} {badge.text}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-primary)' }}>{log.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}



