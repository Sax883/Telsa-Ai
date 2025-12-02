// server.js (For the Node.js Backend)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
// The port is crucial for Render's environment
const port = process.env.PORT || 3000; 

// Create a standard HTTP server
const server = http.createServer(app);

// Initialize Socket.IO server
const io = new Server(server, {
    // Crucial: Configure CORS to allow your live website's domain to connect.
    // Replace 'YOUR_RENDER_FRONTEND_URL' with the actual URL of your live dashboard (e.g., https://telsaai.onrender.com)
    // For local testing, you can use: 'http://127.0.0.1:5500' or 'http://localhost:8080' etc.
    // Using '*' is a quick way to allow all origins, but less secure for production.
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Simple in-memory storage for messages. Not persistent across server restarts!
// In a production app, you would use a database (like MongoDB or Postgres).
let messageHistory = [];

io.on('connection', (socket) => {
    console.log(A user connected: ${socket.id});
    
    // 1. Send the existing message history to the newly connected user
    socket.emit('history', messageHistory);

    // 2. Handle incoming client messages
    socket.on('clientMessage', (data) => {
        // Assume 'data' structure is { userId: 'TAI-001934', message: 'Hello Admin' }
        const fullMessage = {
            id: Date.now(),
            userId: data.userId,
            message: data.message,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            isClient: true // Flag to distinguish client messages
        };
        
        // Save to history
        messageHistory.push(fullMessage);

        // Broadcast the message to all connected clients and the admin
        io.emit('newMessage', fullMessage);
    });
    
    // 3. Handle incoming admin/server replies
    // NOTE: In a proper app, this event should be secured and only accessible by an authenticated admin dashboard.
    socket.on('adminReply', (data) => {
        // Assume 'data' structure is { userId: 'Admin', message: 'I can help you.' }
        const fullMessage = {
            id: Date.now(),
            userId: 'Admin',
            message: data.message,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            isClient: false // Flag to distinguish admin messages
        };

        // Save to history
        messageHistory.push(fullMessage);

        // Broadcast the admin reply to all connected users
        io.emit('newMessage', fullMessage);
    });

    // 4. Handle disconnection
    socket.on('disconnect', () => {
        console.log(User disconnected: ${socket.id});
    });
});

// Simple root route for health check (Render needs this)
app.get('/', (req, res) => {
    res.send('TelsaAI Chat Server is running!');
});

// Start the server
server.listen(port, () => {
    console.log(Chat Server listening on *:${port});
});