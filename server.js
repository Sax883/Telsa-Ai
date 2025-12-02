const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS enabled to accept connections from your custom domain (telsa-ai.org)
const io = new Server(server, {
    cors: {
        origin: "*", // Allows connections from any origin (your telsa-ai.org static site)
        methods: ["GET", "POST"]
    }
});

// Simple in-memory storage for chat history
const chatHistory = [];

// --- Utility Functions ---

// Function to format the timestamp
function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Function to generate a unique Client ID (similar to what the frontend generates)
function generateClientId() {
    return 'TAI-' + Math.floor(100000 + Math.random() * 900000);
}

// --- Socket.IO Connection Logic ---

io.on('connection', (socket) => {
    // 1. Initial Connection & ID Assignment
    // Check if the connection is from the admin (which we defined as the Admin ID) or a client
    // For simplicity, we'll assign a client ID if one isn't provided, though the frontend usually handles this.
    const isClient = socket.handshake.query.isAdmin !== 'true';
    const userId = isClient ? generateClientId() : 'Admin'; 

    // The line that previously caused the SyntaxError is fixed here with backticks:
    console.log('[${getTimestamp()}] A user connected: ${userId} (${socket.id})');

    // 2. Send History
    socket.emit('history', chatHistory);

    // 3. Handle incoming client messages (from dashboard.html)
    socket.on('clientMessage', (msg) => {
        const messageData = {
            userId: msg.userId || userId, // Use the ID passed from the client or the assigned ID
            message: msg.message,
            timestamp: getTimestamp()
        };

        // Store and broadcast to everyone (Admin and other clients)
        chatHistory.push(messageData);
        io.emit('newMessage', messageData);
        
        console.log('[${getTimestamp()}] Client Message [${messageData.userId}]: ${messageData.message}');
    });

    // 4. Handle incoming admin replies (from admin.html)
    socket.on('adminReply', (msg) => {
        const messageData = {
            userId: 'Admin', // Always set sender as Admin
            message: msg.message,
            timestamp: getTimestamp()
        };
        
        // Store and broadcast the admin reply to all connected users
        chatHistory.push(messageData);
        io.emit('newMessage', messageData);

        console.log('[${getTimestamp()}] Admin Reply: ${messageData.message})';
    });

    // 5. Handle disconnection
    socket.on('disconnect', () => {
        console.log('[${getTimestamp()}] User disconnected: ${userId} (${socket.id})');
    });
});

// --- Server Startup ---

// Use the PORT environment variable provided by Render, or default to 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(Chat server listening on port ${PORT});
    console.log(--------------------------------------------------);
    console.log(Deployment successful. Waiting for client connections.);
});