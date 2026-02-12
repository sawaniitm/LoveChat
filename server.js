// ============================================================
// 💝 Valentine's Day Real-Time Chat Server
// Run: node server.js
// Requires: npm install express socket.io uuid
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms: roomId -> { users: [{ socketId, ip, name, avatar }], musicState }
const rooms = new Map();
// Store user data: socketId -> { name, roomId, avatar, ip }
const users = new Map();
// Track IPs per room: roomId -> Set of IPs
const roomIPs = new Map();

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/api/create-room', (req, res) => {
  const roomId = uuidv4().split('-')[0] + uuidv4().split('-')[0];
  res.json({ roomId, link: `/room/${roomId}` });
});

// Get client IP (handles proxies)
function getClientIP(socket) {
  return socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         socket.handshake.headers['x-real-ip'] ||
         socket.handshake.address;
}

io.on('connection', (socket) => {
  const clientIP = getClientIP(socket);
  console.log(`[+] Socket connected: ${socket.id} from IP: ${clientIP}`);

  socket.on('join-room', ({ roomId, userName, avatar }) => {
    const room = rooms.get(roomId) || {
      users: [],
      musicState: { trackIndex: 0, playing: false, time: 0, updatedAt: Date.now() }
    };

    // Check if IP already connected to this room
    const ips = roomIPs.get(roomId) || new Set();
    if (ips.has(clientIP)) {
      socket.emit('ip-already-connected');
      console.log(`[!] IP ${clientIP} already in room ${roomId}`);
      return;
    }

    // Prevent 3rd user
    if (room.users.length >= 2) {
      socket.emit('room-full');
      return;
    }

    socket.join(roomId);
    room.users.push({ socketId: socket.id, ip: clientIP, name: userName, avatar });
    ips.add(clientIP);
    rooms.set(roomId, room);
    roomIPs.set(roomId, ips);
    users.set(socket.id, { name: userName, roomId, avatar, ip: clientIP });

    socket.emit('joined-room', {
      roomId, userCount: room.users.length,
      isAlone: room.users.length === 1, musicState: room.musicState
    });
    socket.to(roomId).emit('partner-joined', { name: userName, avatar, userCount: room.users.length });

    if (room.users.length === 2) {
      const partnerData = room.users.find(u => u.socketId !== socket.id);
      if (partnerData) {
        socket.emit('partner-already-here', { name: partnerData.name, avatar: partnerData.avatar });
        socket.emit('music-sync', { ...room.musicState, elapsed: (Date.now() - room.musicState.updatedAt) / 1000 });
      }
    }
    console.log(`[Room ${roomId}] ${userName} joined (${room.users.length}/2 users) IP: ${clientIP}`);
  });

  socket.on('send-message', ({ roomId, message, timestamp, msgId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(roomId).emit('receive-message', { from: user.name, avatar: user.avatar, message, timestamp, msgId, socketId: socket.id });
  });

  socket.on('typing', ({ roomId, isTyping }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(roomId).emit('partner-typing', { isTyping, name: user.name });
  });

  socket.on('message-seen', ({ roomId, msgId }) => {
    socket.to(roomId).emit('message-seen', { msgId });
  });

  // Music sync (both users can control)
  socket.on('music-control', ({ roomId, trackIndex, playing, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.musicState = { trackIndex, playing, time: currentTime, updatedAt: Date.now() };
    rooms.set(roomId, room);
    socket.to(roomId).emit('music-sync', { trackIndex, playing, time: currentTime, elapsed: 0 });
  });

  // WebRTC signaling
  socket.on('call-request', ({ roomId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(roomId).emit('call-incoming', { from: user.name, avatar: user.avatar, callerId: socket.id });
  });
  socket.on('call-cancelled', ({ roomId }) => { socket.to(roomId).emit('call-cancelled'); });
  socket.on('call-accepted', ({ roomId }) => { socket.to(roomId).emit('call-accepted'); });
  socket.on('call-rejected', ({ roomId }) => { socket.to(roomId).emit('call-rejected'); });
  socket.on('call-ended',    ({ roomId }) => { socket.to(roomId).emit('call-ended'); });
  socket.on('video-offer',   ({ roomId, offer })     => { socket.to(roomId).emit('video-offer',   { offer, from: socket.id }); });
  socket.on('video-answer',  ({ roomId, answer })    => { socket.to(roomId).emit('video-answer',  { answer }); });
  socket.on('ice-candidate', ({ roomId, candidate }) => { socket.to(roomId).emit('ice-candidate', { candidate }); });
  socket.on('toggle-video',  ({ roomId, enabled })   => { socket.to(roomId).emit('remote-toggle-video', { enabled }); });
  socket.on('toggle-audio',  ({ roomId, enabled })   => { socket.to(roomId).emit('remote-toggle-audio', { enabled }); });

  // User leaving/refreshing
  socket.on('leaving-room', ({ roomId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(roomId).emit('partner-ended-chat', { name: user.name });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { roomId, name, ip } = user;
      const room = rooms.get(roomId);
      if (room) {
        room.users = room.users.filter(u => u.socketId !== socket.id);
        if (room.users.length === 0) {
          rooms.delete(roomId);
          roomIPs.delete(roomId);
        } else {
          rooms.set(roomId, room);
          const ips = roomIPs.get(roomId);
          if (ips) {
            ips.delete(ip);
            if (ips.size === 0) roomIPs.delete(roomId);
            else roomIPs.set(roomId, ips);
          }
          io.to(roomId).emit('partner-left', { name });
        }
      }
      users.delete(socket.id);
      console.log(`[-] ${name} disconnected from room ${roomId}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`\n💝 Valentine's Chat running at http://localhost:${PORT}\n`); });
