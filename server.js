const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');

// --- Configuration ---
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.JWT_SECRET || 'a-very-secret-key-that-must-be-long-and-secure';
const app = express();
const server = http.createServer(app);
// Configure CORS for Socket.IO connections (Crucial for client access)
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins for now, restrict this to your frontend URL in production
        methods: ["GET", "POST"]
    }
});

// --- Middleware ---
app.use(bodyParser.json());
// Serve static files from the root directory (for login.html, register.html, dashboard.html)
app.use(express.static(__dirname));

// --- Simulated Database (In-Memory) ---
// In a real app, this would be MongoDB or PostgreSQL
const users = [
    { id: 'admin@telsaai.com', name: 'Admin', email: 'admin@telsaai.com', password: 'password123', isAdmin: true, balance: 999999 },
    // Example client for testing
    { id: 'test@client.com', name: 'Test Client', email: 'test@client.com', password: 'password123', isAdmin: false, balance: 1500 }
];

// In-memory chat history storage
let chatHistory = [];

// --- Helper Functions ---

/**
 * Generates a unique client ID.
 * In a real app, this should generate a secure UUID or use a database ID.
 */
function generateClientId() {
    // Generates a simple 6-digit number string
    const uniqueNum = Math.floor(100000 + Math.random() * 900000);
    return `TAI-${uniqueNum}`;
}

/**
 * Gets a formatted timestamp for logging.
 */
function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}


// --- JWT Authentication Middleware for Socket.IO ---

/**
 * Middleware to authenticate the Socket.IO connection based on the JWT token 
 * passed in the handshake query.
 */
io.use((socket, next) => {
    // Check for a token in the handshake query
    const token = socket.handshake.query.token;

    if (token) {
        try {
            // Verify the token
            const decoded = jwt.verify(token, SECRET_KEY);
            // Attach the user information to the socket for later use
            socket.userData = decoded;
            return next();
        } catch (err) {
            // Token is invalid or expired
            console.error(`[${getTimestamp()}] Socket Auth Error: Invalid token from ${socket.handshake.address}`);
            return next(new Error('Authentication error: Invalid token'));
        }
    }
    // For simplicity, allow unauthenticated connections, but we must assign an ID
    // In a production chat app, you should usually require a token here.
    return next();
});


// --- Express Authentication Routes (For login.html and register.html) ---

/**
 * Route for user login.
 * Expected body: { email, password }
 */
app.post('/api/v1/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    const user = users.find(u => u.email === email && u.password === password);

    if (user) {
        // Successful login: create JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email, isAdmin: user.isAdmin }, 
            SECRET_KEY, 
            { expiresIn: '24h' } // Token expires in 24 hours
        );

        // Return token and safe user data (without password)
        const { password, ...safeUserData } = user;

        return res.json({
            success: true,
            message: 'Login successful.',
            token: token,
            user: safeUserData
        });
    }

    // Invalid credentials
    return res.status(401).json({ 
        success: false,
        message: 'Invalid email or password.' 
    });
});

/**
 * Route for user sign up/registration.
 * Expected body: { name, email, password }
 */
app.post('/api/v1/auth/signup', (req, res) => {
    const { name, email, password } = req.body;

    if (users.some(u => u.email === email)) {
        return res.status(400).json({ 
            success: false,
            message: 'User already exists with this email address.' 
        });
    }

    // Create new user (assuming initial balance is 0 and they are not admin)
    const newUser = {
        id: email, // Using email as a unique ID for simplicity
        name,
        email,
        password,
        isAdmin: false,
        balance: 0 // Initial balance for new clients
    };

    users.push(newUser);

    // Auto-login and generate token
    const token = jwt.sign(
        { id: newUser.id, email: newUser.email, isAdmin: newUser.isAdmin }, 
        SECRET_KEY, 
        { expiresIn: '24h' }
    );
    
    const { password: _, ...safeUserData } = newUser; // Exclude password from response

    return res.status(201).json({
        success: true,
        message: 'Sign up successful.',
        token: token,
        user: safeUserData
    });
});


// --- Socket.IO Connection Logic (Chat Server) ---

io.on('connection', (socket) => {
    
    // 1. Initial Connection & ID Assignment
    let userId;
    let isClient = true; // Assume client unless socket data says otherwise
    
    if (socket.userData) {
        // User authenticated via JWT
        userId = socket.userData.id;
        isClient = !socket.userData.isAdmin;
    } else {
        // User is unauthenticated - assign an ID based on handshake
        const isAdmin = socket.handshake.query.isAdmin === 'true';
        isClient = !isAdmin;
        
        // This line used to be the source of the syntax error
        userId = isClient ? generateClientId() : 'Admin';
    }
    
    // Store userId on the socket for future use
    socket.userId = userId;

    console.log(`[${getTimestamp()}] A user connected: ${userId} (${socket.id})`);

    // 2. Send History
    socket.emit('history', chatHistory);

    // 3. Handle incoming client messages (from dashboard.html)
    socket.on('clientMessage', (msg) => {
        const messageData = {
            userId: socket.userId, // Use the ID assigned above
            message: msg.message,
            timestamp: getTimestamp(),
            isAdmin: !isClient // Clients send messages, so this is false
        };

        // Add to history
        chatHistory.push(messageData);
        // Broadcast to all connected clients (including the sender)
        io.emit('message', messageData);
    });

    // 4. Handle incoming admin messages (from admin.html)
    // NOTE: We should check if the user is actually an admin before accepting
    socket.on('adminMessage', (msg) => {
        if (isClient) {
            console.warn(`[${getTimestamp()}] Non-admin user ${socket.userId} attempted to send admin message.`);
            return; // Block non-admin users
        }
        
        const messageData = {
            userId: socket.userId, // 'Admin'
            message: msg.message,
            timestamp: getTimestamp(),
            isAdmin: true
        };

        // Add to history
        chatHistory.push(messageData);
        // Broadcast to all connected clients
        io.emit('message', messageData);
    });

    // 5. Handle Disconnect
    socket.on('disconnect', () => {
        console.log(`[${getTimestamp()}] User disconnected: ${socket.userId} (${socket.id})`);
    });
});


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`Chat server listening on port ${PORT}`);
    console.log(`Deployment successful. JWT Auth Routes Ready.`);
});