const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

app.set('trust proxy', 1);

// Connect to MongoDB Cloud Database
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ Connected to MongoDB Cloud Database!'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
} else {
    console.warn('⚠️ MONGO_URI not set!');
}

// --- DATABASE SCHEMAS ---
const UserSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: String,
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bio: { type: String, default: 'Official Minion ready for chaos! 🍌' },
    role: { type: String, default: 'Rocket Scientist' },
    avatar: { type: String, default: '🍌' },
    highScore: { type: Number, default: 0 },
    joinedAt: { type: String, default: () => new Date().toLocaleDateString() }
});

const CommentSchema = new mongoose.Schema({
    author: String,
    username: String,
    text: String,
    time: { type: String, default: 'Just now' },
    edited: { type: Boolean, default: false },
    replies: [{
        author: String,
        username: String,
        text: String,
        time: { type: String, default: 'Just now' }
    }]
});

const PostSchema = new mongoose.Schema({
    author: String,
    username: String,
    text: String,
    image: String,
    edited: { type: Boolean, default: false },
    reactions: {
        banana: { type: Number, default: 1 },
        love: { type: Number, default: 0 },
        haha: { type: Number, default: 0 },
        rocket: { type: Number, default: 0 }
    },
    comments: [CommentSchema],
    time: { type: String, default: 'Just now' },
    createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
    sender: String,
    avatar: String,
    text: String,
    time: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);
const Message = mongoose.model('Message', MessageSchema);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'my-desktop-website-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

function isStrongPassword(pwd) {
    if (!pwd || pwd.length < 8) return false;
    const hasLetter = /[a-zA-Z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    const hasSymbol = /[!@#$%^&*(),.?":{}|<>\-_=+]/.test(pwd);
    return hasLetter && hasNumber && hasSymbol;
}

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, phone, username, password } = req.body;
        
        if (!fullName || !email || !phone || !username || !password) {
            return res.status(400).json({ error: 'Please fill in all details!' });
        }

        if (!isStrongPassword(password)) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters with letters, numbers, and a symbol (e.g. Banana!123).'
            });
        }

        const usernameExists = await User.findOne({ username: new RegExp(`^${username.trim()}$`, 'i') });
        if (usernameExists) {
            return res.status(400).json({ error: 'Minion Name (username) is already taken! Try another one.' });
        }

        const emailExists = await User.findOne({ email: new RegExp(`^${email.trim()}$`, 'i') });
        if (emailExists) {
            return res.status(400).json({ error: 'This email is already registered! Please log in instead.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            fullName: fullName.trim(), 
            email: email.trim().toLowerCase(), 
            phone: phone.trim(), 
            username: username.trim(), 
            password: hashedPassword 
        });
        await newUser.save();
        res.json({ message: 'Welcome to Gru’s Crew! You can now log in.' });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Username or Email is already taken!' });
        }
        res.status(500).json({ error: 'Database registration error: ' + err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({
            $or: [
                { username: new RegExp(`^${username.trim()}$`, 'i') },
                { email: new RegExp(`^${username.trim()}$`, 'i') }
            ]
        });
        if (!user) return res.status(400).json({ error: 'Minion not found!' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Incorrect Banana Code!' });

        req.session.userId = user._id;
        res.json({ message: 'Login successful!' });
    } catch (err) {
        res.status(500).json({ error: 'Login server error' });
    }
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        username: user.username,
        bio: user.bio,
        role: user.role,
        avatar: user.avatar,
        highScore: user.highScore,
        joinedAt: user.joinedAt
    });
});

app.post('/api/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { fullName, bio, role, avatar } = req.body;
    const user = await User.findById(req.session.userId);
    if (user) {
        if (fullName) user.fullName = fullName;
        if (bio) user.bio = bio;
        if (role) user.role = role;
        if (avatar) user.avatar = avatar;
        await user.save();
        return res.json({ message: 'Profile updated!', user });
    }
    res.status(404).json({ error: 'User not found' });
});

app.post('/api/highscore', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { score } = req.body;
    const user = await User.findById(req.session.userId);
    if (user && score > user.highScore) {
        user.highScore = score;
        await user.save();
    }
    res.json({ highScore: user ? user.highScore : 0 });
});

// --- MESSAGES ---
app.get('/api/messages', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const messages = await Message.find().sort({ createdAt: 1 }).limit(50);
    res.json(messages);
});

app.post('/api/messages', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message empty' });

    const user = await User.findById(req.session.userId);
    const newMsg = new Message({
        sender: user ? user.fullName : 'Minion',
        avatar: user ? (user.avatar || '🍌') : '🍌',
        text: text.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    await newMsg.save();
    res.json(newMsg);
});

// --- POSTS ---
app.get('/api/posts', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    let posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
});

app.post('/api/posts', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text, image } = req.body;
    if (!text && !image) return res.status(400).json({ error: 'Post empty' });

    const user = await User.findById(req.session.userId);
    const newPost = new Post({
        author: user ? user.fullName : 'Minion',
        username: user ? user.username : 'minion',
        text: text || '',
        image: image || ''
    });
    await newPost.save();
    res.json(newPost);
});

app.put('/api/posts/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text cannot be empty' });

    const user = await User.findById(req.session.userId);
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.username !== user.username) return res.status(403).json({ error: 'Not allowed to edit this post' });

    post.text = text.trim();
    post.edited = true;
    await post.save();
    res.json(post);
});

app.post('/api/posts/:id/react', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { type } = req.body;
    const post = await Post.findById(req.params.id);
    if (post) {
        post.reactions[type] = (post.reactions[type] || 0) + 1;
        await post.save();
        return res.json({ reactions: post.reactions });
    }
    res.status(404).json({ error: 'Post not found' });
});

app.post('/api/posts/:id/comment', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    const user = await User.findById(req.session.userId);
    const post = await Post.findById(req.params.id);
    if (post && text) {
        post.comments.push({
            author: user ? user.fullName : 'Minion',
            username: user ? user.username : 'minion',
            text: text.trim(),
            time: 'Just now'
        });
        await post.save();
        return res.json(post.comments[post.comments.length - 1]);
    }
    res.status(404).json({ error: 'Post not found' });
});

app.put('/api/posts/:postId/comment/:commentId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text cannot be empty' });

    const user = await User.findById(req.session.userId);
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.username !== user.username) return res.status(403).json({ error: 'Not allowed to edit this comment' });

    comment.text = text.trim();
    comment.edited = true;
    await post.save();
    res.json(comment);
});

app.post('/api/posts/:postId/comment/:commentId/reply', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Reply cannot be empty' });

    const user = await User.findById(req.session.userId);
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (!comment.replies) comment.replies = [];
    const newReply = {
        author: user ? user.fullName : 'Minion',
        username: user ? user.username : 'minion',
        text: text.trim(),
        time: 'Just now'
    };
    comment.replies.push(newReply);
    await post.save();
    res.json(newReply);
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: 'Logged out.' }));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));