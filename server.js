const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');

// --- Configuration ---
const app = express();
const PORT = 3000;
const JWT_SECRET = 'your_strong_and_long_jwt_secret_key_12345'; // IMPORTANT: Use a secure, non-guessable key

// --- Middleware ---
app.use(cors()); // Allow all origins for development
app.use(bodyParser.json());
app.use(express.static('public')); // Serve static HTML/CSS/JS files

// --- Mock Database (In-Memory for demonstration) ---
let users = [
    // Pre-registered Admin/Support account
    { 
        id: 'admin@telsaai.com', 
        name: 'TelsaAI Support', 
        email: 'admin@telsaai.com', 
        password: 'secureadminpassword', // In a real app, this would be hashed!
        role: 'admin' 
    }
];
let messages = []; // Live chat messages

// --- Utility Functions ---

/**
 * Creates a unique Client ID based on the user's email.
 * @param {string} email 
 * @returns {string} Unique Client ID string
 */
function createClientId(email) {
    const hash = email.split('').reduce((acc, char) => (acc + char.charCodeAt(0)), 0);
    const uniqueNum = String(hash).padStart(6, '0').slice(-6); // Take last 6 digits of hash
    return TAI-${uniqueNum};
}

/**
 * Middleware to verify the JWT from the Authorization header.
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: Bearer TOKEN

    if (token == null) return res.sendStatus(401); // If no token

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Token invalid or expired
        req.user = user;
        next();
    });
}

// =========================================================
// --- AUTH ROUTES (Login & Sign Up) ---
// =========================================================
const authRouter = express.Router();

// Register New User
authRouter.post('/signup', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required for registration.' });
    }
    
    // Check if user already exists
    if (users.find(u => u.email === email)) {
        return res.status(409).json({ message: 'Registration failed: Email already exists.' });
    }

    // Create a new user object
    const newUser = {
        id: email, // Using email as ID for simplicity
        name,
        email,
        password, // Insecure: Real apps MUST hash passwords
        clientId: createClientId(email),
        role: 'client',
        initials: name.match(/\b(\w)/g).join('').toUpperCase().substring(0, 2),
    };

    users.push(newUser);

    // Generate JWT
    const token = jwt.sign({ id: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: '1h' });

    console.log(New user registered: ${newUser.email});
    res.status(201).json({ 
        message: 'Registration successful!', 
        token, 
        user: { 
            name: newUser.name, 
            email: newUser.email,
            clientId: newUser.clientId,
            initials: newUser.initials
        }
    });
});

// User Login
authRouter.post('/login', (req, res) => {
    const { email, password } = req.body;

    const user = users.find(u => u.email === email && u.password === password);
    
    if (!user) {
        return res.status(401).json({ message: 'Login failed: Invalid credentials.' });
    }
    
    // Generate JWT
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    
    console.log(User logged in: ${user.email});

    res.json({ 
        message: 'Login successful!', 
        token, 
        user: { 
            name: user.name, 
            email: user.email,
            clientId: user.clientId || createClientId(user.email),
            initials: user.initials || user.name.match(/\b(\w)/g).join('').toUpperCase().substring(0, 2)
        }
    });
});

app.use('/api/v1/auth', authRouter);

// =========================================================
// --- USER PROFILE ROUTES (Requires Authentication) ---
// =========================================================
const profileRouter = express.Router();

// Get User Profile Data
profileRouter.get('/me', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const user = users.find(u => u.id === userId);

    if (!user) {
        return res.status(404).json({ message: 'User not found.' });
    }

    // Return sensitive, protected profile data
    res.json({
        name: user.name,
        email: user.email,
        clientId: user.clientId || createClientId(user.email),
        initials: user.initials || user.name.match(/\b(\w)/g).join('').toUpperCase().substring(0, 2),
        address: user.address || 'Not Set',
    });
});

// Update User Profile Data
profileRouter.post('/update', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { name, address, newPassword } = req.body;

    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ message: 'User not found.' });
    }
    
    // Update fields
    if (name) users[userIndex].name = name;
    if (address) users[userIndex].address = address;
    if (newPassword && newPassword.length >= 8) users[userIndex].password = newPassword; // Insecure mock update
    
    // Recalculate initials if name changed
    if (name) {
        users[userIndex].initials = name.match(/\b(\w)/g).join('').toUpperCase().substring(0, 2);
    }

    res.json({ 
        message: 'Profile updated successfully.', 
        name: users[userIndex].name,
        initials: users[userIndex].initials
    });
});

app.use('/api/v1/profile', profileRouter);

// =========================================================
// --- CHAT ROUTES (Requires Authentication) ---
// =========================================================
const chatRouter = express.Router();

// Get All Messages
chatRouter.get('/messages', authenticateToken, (req, res) => {
    // Only return the last 100 messages for simplicity
    res.json(messages.slice(-100)); 
});

// Post a New Message
chatRouter.post('/send', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const user = users.find(u => u.id === userId);
    const { text } = req.body;
    
    if (!text || text.trim() === '') {
        return res.status(400).json({ message: 'Message content is required.' });
    }

    const newMessage = {
        id: Date.now(),
        senderId: userId,
        senderName: user.name,
        senderRole: user.role,
        text: text.trim(),
        timestamp: new Date().toISOString()
    };
    
    messages.push(newMessage);
    
    // Simulate Admin response if client sends a message
    if (user.role === 'client') {
        setTimeout(() => {
            const adminMessage = {
                id: Date.now() + 1,
                senderId: 'admin@telsaai.com',
                senderName: 'TelsaAI Support',
                senderRole: 'admin',
                text: 'Thank you for your message. An advisor will respond shortly.',
                timestamp: new Date().toISOString()
            };
            messages.push(adminMessage);
            console.log('Admin auto-response sent.');
        }, 3000);
    }

    res.status(201).json(newMessage);
});

app.use('/api/v1/chat', chatRouter);

// =========================================================
// --- START SERVER ---
// =========================================================
app.listen(PORT, () => {
    console.log(TelsaAI Server running at http://localhost:${PORT});
    console.log(Admin account: admin@telsaai.com / secureadminpassword);
    console.log(Total current users: ${users.length});
});