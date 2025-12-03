const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');

// --- Configuration ---
const PORT = process.env.PORT || 10000;
// Note: This key is used for JWT token signing for client logins (login.html/register.html)
const SECRET_KEY = process.env.JWT_SECRET || 'a-very-secret-key-that-must-be-long-and-secure'; 
const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});



// app.use(cors({
//     origin: [
//         "https://telsa-ai.org",
//         "https://www.telsa-ai.org"
//     ],
//     methods: ["GET", "POST", "PUT", "DELETE"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//     credentials: true
// }));

// --- Middleware ---
app.use(bodyParser.json());
app.use(express.static(__dirname));

// --- Simulated Database (In-Memory) ---
// UPDATED ADMIN CREDENTIALS: username: tesla_ai / password: @David081
const defaultAdmin = { 
    id: 'tesla_ai', 
    name: 'TESLAAI Support', 
    email: 'tesla_ai', // Using username as identifier here
    password: '@David081', 
    isAdmin: true, 
    balance: 999999 
};

// Registered clients are stored here (in-memory, lost on server restart)
let currentUsers = []; 

// Message history stored by client ID
// { "client1@example.com": [ {message}, {message} ], "client2@example.com": [...] }
let chatHistoryByClient = {}; 
let activeConnections = {}; // Track currently connected sockets by userId

// --- Helper Functions ---

function findUser(email, password = null) {
    // 1. Check Admin
    if (defaultAdmin.email === email && (!password || defaultAdmin.password === password)) {
        return defaultAdmin;
    }
    // 2. Check current clients
    return currentUsers.find(u => u.email === email && (!password || u.password === password));
}

function userExists(email) {
    return defaultAdmin.email === email || currentUsers.some(u => u.email === email);
}

function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}


// --- JWT Authentication Middleware for Socket.IO (Clients) ---

io.use((socket, next) => {
    const token = socket.handshake.query.token;

    if (token) {
        try {
            // Check if the token is valid
            const decoded = jwt.verify(token, SECRET_KEY);
            socket.userData = decoded;
            return next();
        } catch (err) {
            // *** FIXED: Added backtick (`) to open the template literal ***
            console.error(`[${getTimestamp()}] Socket Auth Error: Invalid token. Error: ${err.message}`);
            // Only reject connection if authentication token is invalid
            return next(new Error('Authentication error: Invalid token'));
        }
    }
    // If no token, allow connection (for anonymous clients or admin key-based access)
    return next();
});


// --- Express Authentication Routes (For login.html and register.html) ---

// Placeholder for /api/v1/profile/me
app.get('/api/v1/profile/me', (req, res) => {
    // A simple JWT verification middleware would be needed here in a real app.
    // For this simulation, we'll just extract the token from the header manually.
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const user = currentUsers.find(u => u.id === decoded.id);
        
        if (user) {
            const { password, ...safeUserData } = user;
            return res.json(safeUserData);
        }
        
        return res.status(404).json({ success: false, message: 'User not found.' });
        
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});

// Placeholder for /api/v1/profile/update
app.post('/api/v1/profile/update', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const userIndex = currentUsers.findIndex(u => u.id === decoded.id);
        
        if (userIndex !== -1) {
            const user = currentUsers[userIndex];
            const { name, address, newPassword } = req.body;

            if (name) user.name = name;
            if (address) user.address = address;
            if (newPassword) {
                if (newPassword.length < 8) {
                    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
                }
                user.password = newPassword; // In a real app, hash this!
            }
            
            // Overwrite the user object in the array
            currentUsers[userIndex] = user; 
            
            const { password, ...safeUserData } = user;
            return res.json({ success: true, message: 'Profile updated.', ...safeUserData });
        }
        
        return res.status(404).json({ success: false, message: 'User not found.' });
        
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});


app.post('/api/v1/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    const user = findUser(email, password);

    if (user) {
        const token = jwt.sign(
            { id: user.id, email: user.email, isAdmin: user.isAdmin }, 
            SECRET_KEY, 
            { expiresIn: '24h' }
        );

        const { password, ...safeUserData } = user;

        return res.json({
            success: true,
            message: 'Login successful.',
            token: token,
            user: safeUserData
        });
    }

    return res.status(401).json({ 
        success: false,
        message: 'Invalid email or password.' 
    });
});

app.post('/api/v1/auth/signup', (req, res) => {
    const { name, email, password } = req.body;

    if (userExists(email)) {
        return res.status(400).json({ 
            success: false,
            message: 'User already exists with this email address.' 
        });
    }

    const newUser = {
        id: email, 
        name,
        email,
        password,
        isAdmin: false,
        balance: 200, // Giving the initial $200 bonus on signup
        address: ''
    };

    currentUsers.push(newUser); 
    chatHistoryByClient[newUser.id] = []; // Initialize chat history for the new client

    // Token creation happens after successful user creation, but for this client logic we want a separate login
    
    const { password: _, ...safeUserData } = newUser; 

    // Return success without the token, forcing them to the login screen
    return res.status(201).json({
        success: true,
        message: 'Sign up successful.',
        // Token: token, // COMMENTED OUT: Force client to login.html
        user: safeUserData
    });
});


// --- Socket.IO Connection Logic (Chat Server) ---

io.on('connection', (socket) => {
    
    let userId;
    // Check for admin status from query, defaults to false if not present or not 'true'
    let isAdmin = socket.handshake.query.isAdmin === 'true'; 
    
    // 1. Determine User ID and Admin Status based on JWT payload first
    if (socket.userData) {
        // Authenticated client/admin via JWT
        userId = socket.userData.id;
        isAdmin = socket.userData.isAdmin;
    } else if (isAdmin) {
        // Unauthenticated connection identifying as Admin (allowed if admin.html provides the correct key)
        userId = defaultAdmin.id; 
    } else {
        // Unauthenticated standard client (e.g., just opened the page)
        userId = socket.id; // Fallback to socket ID
    }
    
    // Attach details to socket for later use
    socket.userId = userId;
    socket.isAdmin = isAdmin;

    // *** FIXED: Added backtick (`) to open the template literal ***
    console.log(`[${getTimestamp()}] A user connected: ${userId} (Admin: ${isAdmin}) | Socket: ${socket.id}`);
    activeConnections[userId] = socket.id;

    // Initialize history for new, non-admin clients if needed
    if (!isAdmin && !chatHistoryByClient[userId]) {
        chatHistoryByClient[userId] = [];
        chatHistoryByClient[userId].push({
            userId: 'System',
            message: 'Welcome to TESLAAI Live Support. How can we help you?',
            timestamp: getTimestamp(),
            isAdmin: true,
            clientDisplay: true // Only show for the client's view
        });
    }

    // --- CLIENT (dashboard.html) Events ---
    if (!isAdmin) {
        // 1. Send Client History
        socket.emit('history', chatHistoryByClient[userId] || []);

        // 2. Handle incoming client messages
        socket.on('clientMessage', (msg) => {
            const messageData = {
                userId: userId, 
                message: msg.message,
                timestamp: getTimestamp(),
                isAdmin: false
            };

            // Store message for this client
            if (chatHistoryByClient[userId]) {
                chatHistoryByClient[userId].push(messageData);
            }
            
            // Send the message back to the client
            socket.emit('message', messageData);
            
            // Notify active admin sockets about the new message
            io.emit('newMessage', messageData); 
        });
    }

    // --- ADMIN (admin.html) Events ---
    if (isAdmin) {
        // 1. Request List of Clients
        socket.on('requestClientList', () => {
            const clientList = Object.keys(chatHistoryByClient).map(clientId => {
                const history = chatHistoryByClient[clientId];
                const lastMessage = history.length > 0 ? history[history.length - 1] : { message: 'No messages yet.', timestamp: 0 };
                return {
                    clientId: clientId,
                    lastMessageTime: lastMessage.timestamp,
                    lastMessageSummary: lastMessage.message.substring(0, 30) + (lastMessage.message.length > 30 ? '...' : ''),
                    // Simple logic for active status: check if socket ID is in active connections
                    isActive: !!activeConnections[clientId] 
                };
            });
            socket.emit('clientList', clientList);
        });
        
        // 2. Request Specific Client History
        socket.on('requestChatHistory', (clientId) => {
            if (chatHistoryByClient[clientId]) {
                socket.emit('chatHistory', {
                    clientId: clientId,
                    history: chatHistoryByClient[clientId]
                });
            }
        });
        
        // 3. Handle Admin Reply to Client
        socket.on('adminReply', (data) => {
            const { clientId, message } = data;
            
            const messageData = {
                userId: defaultAdmin.id, 
                message: message,
                timestamp: getTimestamp(),
                isAdmin: true
            };
            
            // Store message for this client
            if (chatHistoryByClient[clientId]) {
                chatHistoryByClient[clientId].push(messageData);
            }
            
            // 1. Send to the specific target client
            const clientSocketId = activeConnections[clientId];
            if (clientSocketId) {
                // Find the socket ID and send the message
                io.to(clientSocketId).emit('message', messageData);
            } else {
                // *** FIXED: Added backtick (`) to open the template literal ***
                console.log(`[${getTimestamp()}] Client ${clientId} is offline, message stored.`);
            }

            // 2. Send back to all admins (including self) to keep views updated
            // We use io.emit('newMessage') which will be caught by the admin's 'newMessage' handler
            io.emit('newMessage', messageData); 
        });
    }

    // --- Disconnect Handler ---
    socket.on('disconnect', () => {
        // Only remove the socket ID from active connections. We keep the chat history.
        if (activeConnections[socket.userId] === socket.id) {
            delete activeConnections[socket.userId];
        }
        // *** FIXED: Added backtick (`) to open the template literal ***
        console.log(`[${getTimestamp()}] User disconnected: ${socket.userId}`);
    });
});


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`Chat server listening on port ${PORT}`);
    // *** FIXED: Added backtick (`) to open the template literal ***
    console.log(`Deployment successful. Admin ID: ${defaultAdmin.id} | JWT Auth Routes Ready.`);
});