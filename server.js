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
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms: roomId -> { users: [socketId], userCount }
const rooms = new Map();
// Store user data: socketId -> { name, roomId, avatar }
const users = new Map();

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Generate a new private room link
app.get('/api/create-room', (req, res) => {
  const roomId = uuidv4().split('-')[0] + uuidv4().split('-')[0];
  res.json({ roomId, link: `/room/${roomId}` });
});

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // User joins a room
  socket.on('join-room', ({ roomId, userName, avatar }) => {
    const room = rooms.get(roomId) || { users: [], userCount: 0 };

    // Prevent 3rd user from joining
    if (room.users.length >= 2) {
      socket.emit('room-full');
      return;
    }

    // Join the socket.io room
    socket.join(roomId);
    room.users.push(socket.id);
    room.userCount = room.users.length;
    rooms.set(roomId, room);

    users.set(socket.id, { name: userName, roomId, avatar });

    // Tell this user about room status
    socket.emit('joined-room', {
      roomId,
      userCount: room.users.length,
      isAlone: room.users.length === 1
    });

    // Notify the other user someone joined
    socket.to(roomId).emit('partner-joined', {
      name: userName,
      avatar,
      userCount: room.users.length
    });

    // Tell THIS new user about existing partner
    if (room.users.length === 2) {
      const partnerSocketId = room.users.find(id => id !== socket.id);
      const partner = users.get(partnerSocketId);
      if (partner) {
        socket.emit('partner-already-here', {
          name: partner.name,
          avatar: partner.avatar
        });
      }
    }

    console.log(`[Room ${roomId}] ${userName} joined (${room.users.length}/2 users)`);
  });

  // Relay chat messages
  socket.on('send-message', ({ roomId, message, timestamp, msgId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(roomId).emit('receive-message', {
      from: user.name,
      avatar: user.avatar,
      message,
      timestamp,
      msgId,
      socketId: socket.id
    });
  });

  // Typing indicator
  socket.on('typing', ({ roomId, isTyping }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(roomId).emit('partner-typing', { isTyping, name: user.name });
  });

  // Message seen (double checkmark)
  socket.on('message-seen', ({ roomId, msgId }) => {
    socket.to(roomId).emit('message-seen', { msgId });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { roomId, name } = user;
      const room = rooms.get(roomId);
      if (room) {
        room.users = room.users.filter(id => id !== socket.id);
        room.userCount = room.users.length;
        if (room.users.length === 0) {
          rooms.delete(roomId);
        } else {
          rooms.set(roomId, room);
          // Notify remaining user
          io.to(roomId).emit('partner-left', { name });
        }
      }
      users.delete(socket.id);
      console.log(`[-] ${name} disconnected from room ${roomId}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n💝 Valentine's Chat Server running at http://localhost:${PORT}\n`);
});
