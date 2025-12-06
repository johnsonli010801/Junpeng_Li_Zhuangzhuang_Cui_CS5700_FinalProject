import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';
let socket = null;

export function connectSocket(token) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (!token) return null;
  socket = io(SOCKET_URL, {
    auth: { token },
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}



