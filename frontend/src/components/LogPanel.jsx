export function LogPanel({ logs }) {
  return (
    <div className="panel">
      <header>
        <h2>活动日志</h2>
      </header>
      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
        <table className="log-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>级别</th>
              <th>描述</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.timestamp).toLocaleString()}</td>
                <td>{log.level}</td>
                <td>{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

