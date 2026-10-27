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
    secret: 'minion_secret_key_123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// MongoDB Atlas Connection Setup
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/minionfeed';

console.log('Connecting to Database...');

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// SCHEMAS & MODELS
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    password: { type: String, required: true },
    avatar: { type: String, default: '' }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    username: { type: String, required: true },
    receiver: { type: String, default: 'public' },
    text: { type: String, default: '' },
    replyTo: { type: String, default: '' },
    reactions: [{
        username: String,
        fullName: String,
        emoji: String
    }]
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// AUTH ROUTES
app.post('/api/register', async (req, res) => {
    try {
        const { username, fullName, password } = req.body;
        if (!username || !fullName || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }
        
        const existing = await User.findOne({ username: username.toLowerCase() });
        if (existing) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({
            username: username.toLowerCase(),
            fullName,
            password: hashedPassword
        });

        req.session.user = { id: newUser._id, username: newUser.username, fullName: newUser.fullName };
        res.json({ success: true, user: req.session.user });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error registering user' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const user = await User.findOne({ username: username.toLowerCase() });
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) {
            return res.status(400).json({ error: 'Incorrect password' });
        }

        req.session.user = { id: user._id, username: user.username, fullName: user.fullName };
        res.json({ success: true, user: req.session.user });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error logging in' });
    }
});

app.get('/api/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    res.json(req.session.user);
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// MESSAGING ROUTES
app.get('/api/messages', async (req, res) => {
    try {
        const msgs = await Message.find({ receiver: 'public' }).sort({ createdAt: 1 }).limit(100);
        res.json(msgs);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.post('/api/messages', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { text, replyTo } = req.body;
        const newMsg = await Message.create({
            sender: req.session.user.fullName,
            username: req.session.user.username,
            receiver: 'public',
            text: text || '',
            replyTo: replyTo || ''
        });
        res.json(newMsg);
    } catch (err) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// EMOJI REACTION ROUTE
app.post('/api/messages/:id/react', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { emoji } = req.body;
        const msg = await Message.findById(req.params.id);
        if (!msg) {
            return res.status(404).json({ error: 'Message not found' });
        }

        // Remove existing reaction by the same user to prevent spam/duplicates, then push the new one
        msg.reactions = msg.reactions.filter(r => r.username !== req.session.user.username);
        msg.reactions.push({
            username: req.session.user.username,
            fullName: req.session.user.fullName,
            emoji
        });

        await msg.save();
        res.json({ success: true, reactions: msg.reactions });
    } catch (err) {
        console.error('Reaction error:', err);
        res.status(500).json({ error: 'Failed to update reaction' });
    }
});

// PRIVATE DMs
app.get('/api/dm/:username', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const me = req.session.user.username;
    const other = req.params.username.toLowerCase();
    try {
        const dms = await Message.find({
            $or: [
                { username: me, receiver: other },
                { username: other, receiver: me }
            ]
        }).sort({ createdAt: 1 });
        res.json(dms);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch DMs' });
    }
});

app.post('/api/dm/:username', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { text, replyTo } = req.body;
        const newDm = await Message.create({
            sender: req.session.user.fullName,
            username: req.session.user.username,
            receiver: req.params.username.toLowerCase(),
            text: text || '',
            replyTo: replyTo || ''
        });
        res.json(newDm);
    } catch (err) {
        res.status(500).json({ error: 'Failed to send DM' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 MinionFeed server running on port ${PORT}`);
});
