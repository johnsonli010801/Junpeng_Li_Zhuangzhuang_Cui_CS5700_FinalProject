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
    { label: 'Total users', value: summary.users, icon: '👥' },
    { label: 'Conversations', value: summary.conversations, icon: '💬' },
    { label: 'Messages', value: summary.messages, icon: '📨' },
    { label: 'Files', value: summary.files, icon: '📎' },
    { label: 'Online users', value: summary.onlineUsers, icon: '🟢' },
  ];

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>📊 Analytics dashboard</h1>
        <p>Monitor system status and usage statistics in real time</p>
      </div>

      <div className="stats-grid">
        {cards.map((card) => (
          <div key={card.label} className="stat-card">
            <div className="stat-label">
              <span style={{ marginRight: '6px' }}>{card.icon}</span>
              {card.label}
            </div>
            <div className="stat-value">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="chart-container">
        <h2>📈 Message trend analysis</h2>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={activity}>
              <defs>
                <linearGradient id="colorMsg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#667eea" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#764ba2" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="day" 
                stroke="#9ca3af"
                style={{ fontSize: '0.875rem' }}
              />
              <YAxis 
                allowDecimals={false} 
                stroke="#9ca3af"
                style={{ fontSize: '0.875rem' }}
              />
              <Tooltip 
                contentStyle={{
                  background: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#667eea"
                strokeWidth={2}
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



