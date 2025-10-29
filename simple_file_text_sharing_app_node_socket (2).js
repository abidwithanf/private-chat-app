/*
Simple File & Text Sharing App — Node + Socket.io
UPDATED: Private messaging (STRICT) + Left-side user list (Messenger style)

Contents:
- server.js (Node/Express/Socket.io/Multer)
- index.html (client) with left sidebar user list, private 1-1 messaging, file upload

Behavior (STRICT private):
- When you send a message or file and you have selected a specific user from the left list,
  the message/file is delivered ONLY to the target user and the sender. No one else sees it.
- If no user is selected, messages go to everyone (public) — you can change this in UX or server.

How to run:
1. Create a new folder and save two files: server.js and index.html (contents below).
2. In terminal run:
   npm init -y
   npm install express socket.io multer cors
   mkdir uploads
3. Start server:
   node server.js
4. Open http://localhost:3000 in multiple browser tabs (or other devices on LAN) to test.

---------------------- server.js ----------------------

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(UPLOAD_DIR));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // return file metadata
  res.json({ url: `/uploads/${req.file.filename}`, originalName: req.file.originalname, size: req.file.size });
});

// Keep track of connected users
const users = {}; // socket.id -> { name }

io.on('connection', (socket) => {
  console.log('connected', socket.id);

  // client sets their display name
  socket.on('set_name', (name) => {
    users[socket.id] = { name: name || 'Anonymous' };
    io.emit('users', getPublicUsers()); // update user list for everyone
  });

  // client requests current user list
  socket.on('get_users', () => {
    socket.emit('users', getPublicUsers());
  });

  socket.on('chat_message', (data) => {
    // data: { type: 'text'|'file', text?, fileUrl?, originalName?, name, targetId? }
    const payload = { ...data, id: Date.now() };
    if (data.targetId) {
      // Strict private: send only to target and echo to sender
      socket.emit('chat_message', { ...payload, private: true });
      io.to(data.targetId).emit('chat_message', { ...payload, private: true });
    } else {
      // public
      io.emit('chat_message', payload);
    }
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    io.emit('users', getPublicUsers());
    console.log('disconnected', socket.id);
  });
});

function getPublicUsers() {
  const out = {};
  for (const id of Object.keys(users)) out[id] = users[id].name;
  return out;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));


---------------------- index.html ----------------------

<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Simple Share — Private Chat</title>
  <style>
    :root { --sidebar: 260px; }
    body { margin:0; font-family: Arial, sans-serif; height:100vh; display:flex; }
    .sidebar { width:var(--sidebar); border-right:1px solid #e0e0e0; padding:12px; box-sizing:border-box; }
    .main { flex:1; display:flex; flex-direction:column; }
    .user { padding:8px; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; }
    .user:hover { background:#f5f5f5; }
    .user.selected { background:#e6f0ff; }
    #messages { flex:1; padding:12px; overflow:auto; background:#fafafa; }
    .msg { margin-bottom:10px; }
    .meta { font-size:12px; color:#666; margin-bottom:4px; }
    .controls { display:flex; gap:8px; padding:12px; border-top:1px solid #eee; }
    .controls input[type=text] { flex:1; padding:8px; }
    .top { display:flex; gap:8px; margin-bottom:10px; align-items:center; }
    .me { font-weight:600; }
    .private-label { font-size:12px; color:#b00; margin-left:6px; }
    .file-preview img { max-width:200px; display:block; margin-top:6px; }
    .small { font-size:12px; color:#444; }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="top">
      <div>
        <div class="small">Your name</div>
        <input id="name" placeholder="Type your name" />
      </div>
    </div>
    <hr/>
    <div class="small">Connected users</div>
    <div id="users"></div>
    <div style="margin-top:12px; font-size:12px; color:#666">Select a user to chat privately. Click again to deselect.</div>
  </div>

  <div class="main">
    <div style="padding:12px; border-bottom:1px solid #eee; display:flex; align-items:center; justify-content:space-between;">
      <div>
        <span class="me">Chat</span>
        <span id="currentTarget" class="private-label"></span>
      </div>
      <div class="small">Status: <span id="status">Not connected</span></div>
    </div>

    <div id="messages"></div>

    <div class="controls">
      <input id="text" type="text" placeholder="Type a message" />
      <input id="file" type="file" />
      <button id="send">Send</button>
      <button id="upload">Upload & Send</button>
    </div>
  </div>

  <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
  <script>
    const socket = io();
    const usersDiv = document.getElementById('users');
    const nameInput = document.getElementById('name');
    const messages = document.getElementById('messages');
    const text = document.getElementById('text');
    const send = document.getElementById('send');
    const fileInput = document.getElementById('file');
    const upload = document.getElementById('upload');
    const currentTargetLabel = document.getElementById('currentTarget');
    const status = document.getElementById('status');

    let selectedTarget = null; // socket id of selected user
    let meId = null;

    function addMessage(html) {
      const div = document.createElement('div');
      div.className = 'msg';
      div.innerHTML = html;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function renderUsers(list) {
      usersDiv.innerHTML = '';
      const keys = Object.keys(list);
      if (keys.length === 0) { usersDiv.innerHTML = '<div class="small">No other users</div>'; return; }
      keys.forEach(id => {
        const div = document.createElement('div');
        div.className = 'user';
        div.dataset.id = id;
        div.innerHTML = `<div>${escapeHtml(list[id])}${id === meId ? ' (You)' : ''}</div>`;
        if (id === selectedTarget) div.classList.add('selected');
        div.addEventListener('click', () => {
          if (id === meId) return; // don't select yourself
          if (selectedTarget === id) { selectedTarget = null; currentTargetLabel.textContent = ''; } else { selectedTarget = id; currentTargetLabel.textContent = 'Private → ' + list[id]; }
          renderUsers(list);
        });
        usersDiv.appendChild(div);
      });
    }

    socket.on('connect', () => {
      meId = socket.id;
      status.textContent = 'Connected';
      // if the user already typed a name, set it
      if (nameInput.value.trim()) socket.emit('set_name', nameInput.value.trim());
      socket.emit('get_users');
    });

    socket.on('disconnect', () => { status.textContent = 'Disconnected'; });

    // receive users list
    socket.on('users', (users) => {
      // ensure current user id known
      if (!meId) meId = socket.id;
      renderUsers(users);
    });

    socket.on('chat_message', (data) => {
      // data: { type, text, fileUrl, originalName, name, id, private }
      const when = new Date(data.id).toLocaleTimeString();
      const who = escapeHtml(data.name || 'Anonymous');
      if (data.type === 'text') {
        const priv = data.private ? ' <span class="private-label">(private)</span>' : '';
        addMessage(`<div class="meta">${who} • ${when} ${priv}</div><div>${escapeHtml(data.text)}</div>`);
      } else if (data.type === 'file') {
        const name = escapeHtml(data.originalName || data.fileUrl);
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
        if (isImage) {
          addMessage(`<div class="meta">${who} • ${when} <span class="private-label">${data.private ? '(private)' : ''}</span></div><div><a href="${data.fileUrl}" target="_blank"><img src="${data.fileUrl}" class="file-preview"/></a><div>${name}</div></div>`);
        } else {
          addMessage(`<div class="meta">${who} • ${when} <span class="private-label">${data.private ? '(private)' : ''}</span></div><div><a href="${data.fileUrl}" target="_blank">Download: ${name}</a></div>`);
        }
      }
    });

    // name change
    nameInput.addEventListener('change', () => {
      const name = nameInput.value.trim() || 'Anonymous';
      socket.emit('set_name', name);
    });

    send.addEventListener('click', () => {
      const textVal = text.value.trim();
      if (!textVal) return;
      const name = nameInput.value.trim() || 'Anonymous';
      const payload = { type: 'text', text: textVal, name, targetId: selectedTarget };
      socket.emit('chat_message', payload);
      text.value = '';
    });

    text.addEventListener('keypress', (e) => { if (e.key === 'Enter') send.click(); });

    upload.addEventListener('click', async () => {
      const f = fileInput.files[0];
      if (!f) return alert('Choose a file first');
      const name = nameInput.value.trim() || 'Anonymous';
      const form = new FormData();
      form.append('file', f);
      try {
        const res = await fetch('/upload', { method: 'POST', body: form });
        const json = await res.json();
        if (json.error) return alert(json.error);
        socket.emit('chat_message', { type: 'file', fileUrl: json.url, originalName: json.originalName, name, targetId: selectedTarget });
        fileInput.value = '';
      } catch (err) {
        alert('Upload failed');
        console.error(err);
      }
    });

    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]; }); }
  </script>
</body>
</html>

*/

// ---------------- SERVER.JS COMPLETE CODE BELOW ----------------

const express = require('express');
const http = require('http');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Setup server + socket\ nconst server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

let users = {};

io.on('connection', (socket) => {
  socket.on('register', (name) => {
    users[socket.id] = name;
    io.emit('userList', users);
  });

  socket.on('privateMessage', ({ targetId, message }) => {
    if (users[targetId]) {
      io.to(targetId).emit('privateMessage', {
        from: socket.id,
        name: users[socket.id],
        message
      });
      io.to(socket.id).emit('privateMessage', {
        from: socket.id,
        name: users[socket.id],
        message
      });
    }
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    io.emit('userList', users);
  });
});

app.post('/upload', upload.single('file'), (req, res) => {
  res.json({ filename: req.file.filename });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));

// ---------------- END SERVER.JS ----------------
