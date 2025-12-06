import { db } from '../db.js';

export function createDashboardController(onlineUsers) {
  const getSummary = (_req, res) => {
    res.json({
      users: db.data.users.length,
      conversations: db.data.conversations.length,
      messages: db.data.messages.length,
      files: db.data.files.length,
      onlineUsers: onlineUsers.size,
    });
  };

  const getActivity = (_req, res) => {
    const perDay = {};
    db.data.messages.forEach((msg) => {
      const day = msg.createdAt.slice(0, 10);
      perDay[day] = (perDay[day] || 0) + 1;
    });
    const data = Object.entries(perDay)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([day, count]) => ({ day, count }));

    const connectionEvents = db.data.logs
      .filter((log) => log.message.includes('connection'))
      .slice(-50);

    res.json({
      messagesPerDay: data,
      recentConnections: connectionEvents,
    });
  };

  const getLogs = (_req, res) => {
    const latest = db.data.logs.slice(-100).reverse();
    res.json({ logs: latest });
  };

  return {
    getSummary,
    getActivity,
    getLogs,
  };
}


