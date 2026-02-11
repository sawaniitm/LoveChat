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

const rooms = new Map();
const users = new Map();

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

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, userName, avatar }) => {
    const room = rooms.get(roomId) || {
      users: [], userCount: 0,
      musicState: { trackIndex: 0, playing: false, time: 0, updatedAt: Date.now() }
    };
    if (room.users.length >= 2) { socket.emit('room-full'); return; }

    socket.join(roomId);
    room.users.push(socket.id);
    room.userCount = room.users.length;
    rooms.set(roomId, room);
    users.set(socket.id, { name: userName, roomId, avatar });

    socket.emit('joined-room', {
      roomId, userCount: room.users.length,
      isAlone: room.users.length === 1, musicState: room.musicState
    });
    socket.to(roomId).emit('partner-joined', { name: userName, avatar, userCount: room.users.length });

    if (room.users.length === 2) {
      const partnerSocketId = room.users.find(id => id !== socket.id);
      const partner = users.get(partnerSocketId);
      if (partner) {
        socket.emit('partner-already-here', { name: partner.name, avatar: partner.avatar });
        socket.emit('music-sync', { ...room.musicState, elapsed: (Date.now() - room.musicState.updatedAt) / 1000 });
      }
    }
    console.log(`[Room ${roomId}] ${userName} joined (${room.users.length}/2 users)`);
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

  // Music sync
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
    socket.to(roomId).emit('call-incoming', { from: user.name, avatar: user.avatar });
  });
  socket.on('call-accepted', ({ roomId }) => { socket.to(roomId).emit('call-accepted'); });
  socket.on('call-rejected', ({ roomId }) => { socket.to(roomId).emit('call-rejected'); });
  socket.on('call-ended',    ({ roomId }) => { socket.to(roomId).emit('call-ended'); });
  socket.on('video-offer',   ({ roomId, offer })     => { socket.to(roomId).emit('video-offer',   { offer, from: socket.id }); });
  socket.on('video-answer',  ({ roomId, answer })    => { socket.to(roomId).emit('video-answer',  { answer }); });
  socket.on('ice-candidate', ({ roomId, candidate }) => { socket.to(roomId).emit('ice-candidate', { candidate }); });
  socket.on('toggle-video',  ({ roomId, enabled })   => { socket.to(roomId).emit('remote-toggle-video', { enabled }); });
  socket.on('toggle-audio',  ({ roomId, enabled })   => { socket.to(roomId).emit('remote-toggle-audio', { enabled }); });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { roomId, name } = user;
      const room = rooms.get(roomId);
      if (room) {
        room.users = room.users.filter(id => id !== socket.id);
        room.userCount = room.users.length;
        if (room.users.length === 0) { rooms.delete(roomId); }
        else { rooms.set(roomId, room); io.to(roomId).emit('partner-left', { name }); io.to(roomId).emit('call-ended'); }
      }
      users.delete(socket.id);
      console.log(`[-] ${name} disconnected from room ${roomId}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`\n💝 Valentine's Chat running at http://localhost:${PORT}\n`); });
