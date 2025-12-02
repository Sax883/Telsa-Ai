const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

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

// Function to format the timestamp
function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Function to generate a unique Client ID
function generateClientId() {
    // Generate a unique ID like TAI-123456
    return 'TAI-' + Math.floor(100000 + Math.random() * 900000);
}

// --- Socket.IO Connection Logic ---

io.on('connection', (socket) => {
    
    // 1. Initial Connection & ID Assignment
    // Check if the connection is from the admin or a client
    const isClient = socket.handshake.query.isAdmin !== 'true';
    const userId = isClient ? generateClientId() : 'Admin'; 

    // **THIS IS THE CORRECTED LOGGING LINE**
    console.log(`[${getTimestamp()}] A user connected: ${userId} (${socket.id})`);

    // 2. Send History
    socket.emit('history', chatHistory);

    // 3. Handle incoming client messages (from dashboard.html)
    socket.on('clientMessage', (msg) => {
        const messageData = {
            userId: msg.userId || userId, 
            message: msg.message,
            timestamp: getTimestamp()
        };

        // Store and broadcast to everyone (Admin and other clients)
        chatHistory.push(messageData);
        io.emit('newMessage', messageData);
        
        console.log(`[${getTimestamp()}] Client Message [${messageData.userId}]: ${messageData.message}`);
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

        console.log(`[${getTimestamp()}] Admin Reply: ${messageData.message}`);
    });

    // 5. Handle disconnection
    socket.on('disconnect', () => {
        console.log(`[${getTimestamp()}] User disconnected: ${userId} (${socket.id})`);
    });
});

// --- Server Startup ---

// Use the PORT environment variable provided by Render, or default to 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Chat server listening on port ${PORT}`);
    console.log(`--------------------------------------------------`);
    console.log(`Deployment successful. Waiting for client connections.`);
});