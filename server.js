const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'minion_secret_key_999',
    resave: false,
    saveUninitialized: false
}));

mongoose.connect('mongodb://localhost:27017/minionfeed', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB')).catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullName: { type: String, required: true },
    role: { type: String, default: 'Minion' },
    avatar: { type: String, default: '🍌' }
});
const User = mongoose.model('User', userSchema);

const postSchema = new mongoose.Schema({
    username: { type: String, required: true },
    author: { type: String, required: true },
    text: { type: String },
    image: { type: String },
    reactions: { type: Object, default: { banana: 0, love: 0, haha: 0, rocket: 0 } },
    comments: [{
        username: String,
        author: String,
        text: String,
        createdAt: { type: Date, default: Date.now },
        replies: [{ username: String, author: String, text: String, createdAt: { type: Date, default: Date.now } }]
    }],
    createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

// Message schema storing who reacted with what emoji
const messageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    username: { type: String, required: true },
    recipient: { type: String },
    text: { type: String, required: true },
    replyTo: { type: String },
    reactions: [{
        emoji: String,
        username: String,
        fullName: String
    }],
    createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Auth Routes
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, fullName } = req.body;
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).send('Username already taken');
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword, fullName });
        await user.save();
        req.session.user = { username: user.username, fullName: user.fullName };
        res.status(201).send('Registered successfully');
    } catch (err) { res.status(500).send('Server error'); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).send('Invalid credentials');
        }
        req.session.user = { username: user.username, fullName: user.fullName, avatar: user.avatar, role: user.role };
        res.send('Logged in successfully');
    } catch (err) { res.status(500).send('Server error'); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.send('Logged out')); });
app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    res.json(req.session.user);
});
app.get('/api/users', async (req, res) => {
    try { res.json(await User.find({}, 'username fullName role avatar')); } catch (err) { res.status(500).send('Server error'); }
});

// Posts Routes
app.get('/api/posts', async (req, res) => {
    try { res.json(await Post.find().sort({ createdAt: -1 })); } catch (err) { res.status(500).send('Server error'); }
});
app.post('/api/posts', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).send('Unauthorized');
        const { text, image } = req.body;
        const post = new Post({ username: req.session.user.username, author: req.session.user.fullName, text, image });
        await post.save();
        res.status(201).json(post);
    } catch (err) { res.status(500).send('Server error'); }
});
app.delete('/api/posts/:id', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).send('Unauthorized');
        const post = await Post.findById(req.params.id);
        if (!post || post.username !== req.session.user.username) return res.status(403).send('Forbidden');
        await Post.findByIdAndDelete(req.params.id);
        res.send('Deleted');
    } catch (err) { res.status(500).send('Server error'); }
});
app.post('/api/posts/:id/react', async (req, res) => {
    try {
        const { type } = req.body;
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).send('Not found');
        post.reactions[type] = (post.reactions[type] || 0) + 1;
        post.markModified('reactions');
        await post.save();
        res.json(post);
    } catch (err) { res.status(500).send('Server error'); }
});
app.post('/api/posts/:id/comment', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).send('Unauthorized');
        const { text } = req.body;
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).send('Not found');
        post.comments.push({ username: req.session.user.username, author: req.session.user.fullName, text });
        await post.save();
        res.status(201).json(post);
    } catch (err) { res.status(500).send('Server error'); }
});

// Chat / Messages Routes
app.get('/api/messages', async (req, res) => {
    try { res.json(await Message.find({ recipient: { $exists: false } }).sort({ createdAt: 1 })); } catch (err) { res.status(500).send('Server error'); }
});
app.post('/api/messages', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).send('Unauthorized');
        const { text, replyTo } = req.body;
        const msg = new Message({ sender: req.session.user.fullName, username: req.session.user.username, text, replyTo });
        await msg.save();
        res.status(201).json(msg);
    } catch (err) { res.status(500).send('Server error'); }
});
app.get('/api/dm/:username', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).send('Unauthorized');
        const me = req.session.user.username;
        const target = req.params.username;
        const messages = await Message.find({ $or: [{ username: me, recipient: target }, { username: target, recipient: me }] }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) { res.status(500).send('Server error'); }
});
app.post('/api/dm/:username', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).send('Unauthorized');
        const me = req.session.user;
        const target = req.params.username;
        const { text, replyTo } = req.body;
        const msg = new Message({ sender: me.fullName, username: me.username, recipient: target, text, replyTo });
        await msg.save();
        res.status(201).json(msg);
    } catch (err) { res.status(500).send('Server error'); }
});
app.get('/api/dms', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).send('Unauthorized');
        const me = req.session.user.username;
        const msgs = await Message.find({ $or: [{ username: me }, { recipient: me }], recipient: { $exists: true } });
        const partnerUsernames = new Set();
        msgs.forEach(m => {
            if (m.username !== me) partnerUsernames.add(m.username);
            if (m.recipient !== me) partnerUsernames.add(m.recipient);
        });
        const partners = await User.find({ username: { $in: Array.from(partnerUsernames) } }, 'username fullName avatar');
        res.json(partners);
    } catch (err) { res.status(500).send('Server error'); }
});

// Working Reaction Route that records WHO reacted
app.post('/api/messages/:id/react', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).send('Unauthorized');
        const { emoji } = req.body;
        const msg = await Message.findById(req.params.id);
        if (!msg) return res.status(404).send('Message not found');

        if (!msg.reactions) msg.reactions = [];
        // Remove existing reaction by this user if any, or toggle
        msg.reactions = msg.reactions.filter(r => r.username !== req.session.user.username);
        msg.reactions.push({ emoji, username: req.session.user.username, fullName: req.session.user.fullName });

        await msg.save();
        res.json(msg);
    } catch (err) { res.status(500).send('Server error'); }
});

app.get('/api/notifications', async (req, res) => { res.json([]); });
app.post('/api/notifications/read', (req, res) => { res.send('OK'); });
app.post('/api/highscore', (req, res) => { res.send('OK'); });

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
