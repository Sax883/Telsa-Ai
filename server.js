const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken'); // Added JWT

const app = express();
const server = http.createServer(app);

// CRUCIAL: Read the secret key from the environment variable set on Render.
const JWT_SECRET = process.env.JWT_SECRET || 'YOUR_FALLBACK_DEV_KEY_CHANGE_ME'; 

// Initialize Socket.IO with CORS enabled
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Simple in-memory storage for chat history
const chatHistory = [];

// --- Utility Functions ---

function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// --- NEW LOGIN/AUTH ROUTE ---
app.use(express.json()); // Middleware to parse JSON body requests

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    // --- DUMMY AUTH CHECK: Replace this with your actual database/user verification! ---
    // The username (email) will serve as the unique Client ID.
    const SIMULATED_EMAIL = 'test@teslaai.com'; 
    const SIMULATED_PASSWORD = 'password123';
    
    // Check for SIMULATED successful login OR the user registered via the simple localStorage method
    const registeredEmail = process.env.REG_EMAIL || SIMULATED_EMAIL;
    const registeredPassword = process.env.REG_PASS || SIMULATED_PASSWORD;

    let isAuthenticated = false;
    let clientId = null;

    if ((email.toLowerCase() === SIMULATED_EMAIL && password === SIMULATED_PASSWORD) || 
        (email.toLowerCase() === registeredEmail && password === registeredPassword)) {
        isAuthenticated = true;
        clientId = email.toLowerCase(); // Use email as unique identifier
    }
    // -----------------------------------------------------------------------------------

    if (isAuthenticated) { 
        // AUTH SUCCESS: Generate a JWT with the unique Client ID
        const token = jwt.sign({ clientId: clientId }, JWT_SECRET, { expiresIn: '7d' });

        return res.json({ 
            success: true, 
            message: 'Login successful.',
            token: token,
            clientId: clientId,
            userName: "TelsaAi Client" // Or fetch actual name from database
        });
    }

    // AUTH FAILURE
    res.status(401).json({ success: false, message: 'Invalid credentials.' });
});
// ------------------------------------

// --- Socket.IO Connection Logic ---

io.on('connection', (socket) => {
    
    // 1. Initial Connection & ID Assignment
    // The server doesn't assign ID; the client script passes the authenticated ID
    const isClient = socket.handshake.query.isAdmin !== 'true';
    const userId = socket.handshake.query.clientId || (isClient ? 'ANON-' + socket.id.substring(0, 4) : 'Admin'); 

    console.log(`[${getTimestamp()}] A user connected: ${userId} (${socket.id})`);

    // ... (rest of the socket logic remains the same)
    // ... (rest of the socket logic remains the same)
    
    // 2. Send History
    socket.emit('history', chatHistory);

    // 3. Handle incoming client messages (from dashboard.html)
    socket.on('clientMessage', (msg) => {
        const messageData = {
            userId: msg.userId || userId, 
            message: msg.message,
            timestamp: getTimestamp()
        };

        chatHistory.push(messageData);
        io.emit('newMessage', messageData);
        
        console.log(`[${getTimestamp()}] Client Message [${messageData.userId}]: ${messageData.message}`);
    });

    // 4. Handle incoming admin replies (from admin.html)
    socket.on('adminReply', (msg) => {
        const messageData = {
            userId: 'Admin', 
            message: msg.message,
            timestamp: getTimestamp()
        };
        
        chatHistory.push(messageData);
        io.emit('newMessage', messageData);

        console.log(`[${getTimestamp()}] Admin Reply: ${messageData.message}`);
    });

    // 5. Handle disconnection
    socket.on('disconnect', () => {
        console.log(`[${getTimestamp()}] User disconnected: ${userId} (${socket.id})`);
    });
});

// --- Server Startup ---

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Chat server listening on port ${PORT}`);
    console.log(`--------------------------------------------------`);
    console.log(`Deployment successful. JWT Auth Route Ready.`);
});