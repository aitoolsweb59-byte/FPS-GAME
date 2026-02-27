// ============================================
//   LONE WOLF — FPS Multiplayer Server
//   Node.js + Socket.io
// ============================================
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin:'*', methods:['GET','POST'] } });

// Serve game file
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'index.html')));

// ── Rooms: each room holds exactly 2 players
const rooms   = {}; // roomCode → { p1: socketId, p2: socketId, state: {} }
const players = {}; // socketId → { name, room, hp, pos }
const waiting = []; // queue of sockets waiting for a public match

function findOrCreateRoom(socket, name, roomCode) {
  if(roomCode) {
    // Private room
    if(!rooms[roomCode]) {
      rooms[roomCode] = { p1: socket.id, p2: null };
      players[socket.id] = { name, room: roomCode, hp: 100 };
      socket.join(roomCode);
      socket.emit('waitingForOpponent');
      console.log(`[Room ${roomCode}] ${name} created room`);
    } else if(!rooms[roomCode].p2) {
      rooms[roomCode].p2 = socket.id;
      players[socket.id] = { name, room: roomCode, hp: 100 };
      socket.join(roomCode);
      matchReady(roomCode);
    } else {
      socket.emit('roomFull');
    }
  } else {
    // Public matchmaking
    players[socket.id] = { name, room: null, hp: 100 };
    if(waiting.length > 0) {
      const opponent = waiting.shift();
      if(!io.sockets.sockets.get(opponent)) { findOrCreateRoom(socket, name, ''); return; }
      const code = 'PUB_' + Math.random().toString(36).slice(2,8).toUpperCase();
      rooms[code] = { p1: opponent, p2: socket.id };
      players[opponent].room = code;
      players[socket.id].room = code;
      socket.join(code);
      io.sockets.sockets.get(opponent)?.join(code);
      matchReady(code);
    } else {
      waiting.push(socket.id);
      socket.emit('waitingForOpponent');
      console.log(`[Queue] ${name} waiting for match`);
    }
  }
}

function matchReady(roomCode) {
  const room = rooms[roomCode];
  const p1 = players[room.p1];
  const p2 = players[room.p2];
  console.log(`[Room ${roomCode}] Match: ${p1?.name} vs ${p2?.name}`);
  io.to(room.p1).emit('matchReady', { opponentName: p2?.name || 'ENEMY' });
  io.to(room.p2).emit('matchReady', { opponentName: p1?.name || 'ENEMY' });
}

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('fps_join', ({ name, room }) => {
    const playerName = (name||'PLAYER').toUpperCase().slice(0,12);
    const roomCode = (room||'').toUpperCase().trim();
    findOrCreateRoom(socket, playerName, roomCode);
  });

  socket.on('fps_move', (data) => {
    const p = players[socket.id];
    if(!p?.room) return;
    p.pos = data;
    socket.to(p.room).emit('opponentMoved', { x:data.x, y:data.y, z:data.z, ry:data.ry });
  });

  socket.on('fps_shot', (data) => {
    const p = players[socket.id];
    if(!p?.room) return;
    if(data.hit) {
      const dmg = data.headshot ? 85 : 24;
      const room = rooms[p.room];
      if(!room) return;
      const oppId = room.p1 === socket.id ? room.p2 : room.p1;
      const opp = players[oppId];
      if(opp) {
        opp.hp = Math.max(0, (opp.hp||100) - dmg);
        // Tell shooter they hit
        socket.emit('opponentHit', { dmg, headshot: data.headshot });
        // Tell opponent they were hit
        io.to(oppId).emit('opponentShot', { hit:true, headshot:data.headshot });
        // Check death
        if(opp.hp <= 0) {
          io.to(p.room).emit('roundResult', { winner: socket.id });
          // Reset HP for next round
          opp.hp = 100;
          if(p) p.hp = 100;
        }
      }
    } else {
      // Miss — just notify opponent (optional)
    }
  });

  socket.on('fps_reload', () => {
    const p = players[socket.id];
    if(!p?.room) return;
    socket.to(p.room).emit('opponentReloading');
  });

  socket.on('ping_fps', () => socket.emit('pong_fps'));

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if(p?.room) {
      socket.to(p.room).emit('opponentLeft');
      const room = rooms[p.room];
      if(room) {
        if(room.p1===socket.id) room.p1=null;
        if(room.p2===socket.id) room.p2=null;
        if(!room.p1 && !room.p2) delete rooms[p.room];
      }
    }
    // Remove from waiting queue
    const wi = waiting.indexOf(socket.id);
    if(wi>=0) waiting.splice(wi,1);
    delete players[socket.id];
    console.log(`[-] ${socket.id} disconnected`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🎮 Lone Wolf FPS Server on port ${PORT}\n`));
