import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client.js';
import { LogPanel } from '../components/LogPanel.jsx';

function DashboardPage() {
  const [summary, setSummary] = useState({
    users: 0,
    conversations: 0,
    messages: 0,
    files: 0,
    onlineUsers: 0,
  });
  const [activity, setActivity] = useState([]);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const load = async () => {
      const [summaryRes, activityRes, logsRes] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/dashboard/activity'),
        api.get('/logs'),
      ]);
      setSummary(summaryRes.data);
      setActivity(activityRes.data.messagesPerDay);
      setLogs(logsRes.data.logs);
    };
    load();
  }, []);

  const cards = [
    { label: '用户', value: summary.users },
    { label: '会话', value: summary.conversations },
    { label: '消息', value: summary.messages },
    { label: '文件', value: summary.files },
    { label: '在线', value: summary.onlineUsers },
  ];

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card-grid">
        {cards.map((card) => (
          <div key={card.label} className="stat-card">
            <div className="stat-label">{card.label}</div>
            <div className="stat-value">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <header>
          <h2>消息吞吐趋势</h2>
        </header>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={activity}>
              <defs>
                <linearGradient id="colorMsg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#2563eb"
                fillOpacity={1}
                fill="url(#colorMsg)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <LogPanel logs={logs} />
    </div>
  );
}

export default DashboardPage;

