const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'minion-secret-key-1234',
    resave: false,
    saveUninitialized: false
}));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://rollyong0115_db_user:Minion123@cluster0.bjtl1i4.mongodb.net/minionfeed?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Schemas & Models
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
    sender: String,
    username: String,
    text: String,
    createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// --- API ROUTES ---

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, fullName, password } = req.body;
        if (!username || !password || !fullName) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, fullName, password: hashedPassword });
        await newUser.save();

        req.session.userId = newUser._id;
        res.json({ message: 'Registered successfully' });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid password' });
        }

        req.session.userId = user._id;
        res.json({ message: 'Logged in successfully' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error logging in' });
    }
});

// Check Session
app.get('/api/me', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    try {
        const user = await User.findById(req.session.userId).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Messages Feed
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await Message.find().sort({ createdAt: -1 }).limit(50);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Post Message
app.post('/api/messages', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const user = await User.findById(req.session.userId);
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Message text required' });

        const newMsg = new Message({
            sender: user.fullName,
            username: user.username,
            text
        });
        await newMsg.save();
        res.json({ message: 'Posted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to post message' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 MinionFeed server running on port ${PORT}`);
});
