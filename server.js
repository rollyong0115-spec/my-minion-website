const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://rollyong0115_db_user:ST9HMoXn0lysvoPm@ac-k5dzvq1-shard-00-00.bjtl1i4.mongodb.net:27017,ac-k5dzvq1-shard-00-01.bjtl1i4.mongodb.net:27017,ac-k5dzvq1-shard-00-02.bjtl1i4.mongodb.net:27017/?ssl=true&replicaSet=atlas-10bi1m-shard-0&authSource=admin';

app.set('trust proxy', 1);

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || ''
    }
});

// --- SCHEMAS & MODELS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    password: { type: String, required: true },
    bio: { type: String, default: 'Living life one banana at a time! 🍌' },
    location: { type: String, default: "Gru's Secret Lab" },
    role: { type: String, default: 'Rocket Scientist' },
    avatar: { type: String, default: '' },
    coverPhoto: { type: String, default: '' },
    highScore: { type: Number, default: 0 },
    friends: [{ type: String }],
    blockedUsers: [{ type: String }],
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    joinedAt: { type: String, default: () => new Date().toLocaleDateString() }
});
const User = mongoose.model('User', UserSchema);

const CommentSchema = new mongoose.Schema({
    author: String,
    username: String,
    text: String,
    edited: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    replies: [{
        author: String,
        username: String,
        text: String,
        createdAt: { type: Date, default: Date.now }
    }]
});

const PostSchema = new mongoose.Schema({
    author: String,
    username: String,
    text: String,
    image: String,
    edited: { type: Boolean, default: false },
    reactions: { type: mongoose.Schema.Types.Mixed, default: [] },
    comments: [CommentSchema],
    createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

const MessageSchema = new mongoose.Schema({
    sender: String,
    username: String,
    text: String,
    replyTo: String,
    reactions: [{
        emoji: String,
        fullName: String,
        username: String
    }],
    createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const DMSchema = new mongoose.Schema({
    sender: String,
    recipient: String,
    text: String,
    replyTo: String,
    reactions: [{
        emoji: String,
        fullName: String,
        username: String
    }],
    createdAt: { type: Date, default: Date.now }
});
const DM = mongoose.model('DM', DMSchema);

const NotificationSchema = new mongoose.Schema({
    recipient: { type: String, required: true },
    sender: { type: String, required: true },
    senderUsername: { type: String, required: true },
    type: { type: String, required: true },
    text: { type: String, required: true },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', NotificationSchema);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'minion-secret-key-1234',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

function isStrongPassword(pwd) {
    return pwd && pwd.length >= 8 && /[a-zA-Z]/.test(pwd) && /[0-9]/.test(pwd) && /[!@#$%^&*(),.?":{}|<>\-_=+]/.test(pwd);
}

async function notifyMentions(text, sender) {
    const matches = text.match(/@([a-zA-Z0-9_.-]+)/g);
    if (!matches) return;
    for (let m of matches) {
        const uName = m.replace('@', '').toLowerCase();
        if (uName !== sender.username.toLowerCase()) {
            const user = await User.findOne({ username: new RegExp(`^${uName}$`, 'i') });
            if (user) {
                await Notification.create({
                    recipient: user.username,
                    sender: sender.fullName,
                    senderUsername: sender.username,
                    type: 'mention',
                    text: `${sender.fullName} mentioned you: "${text.substring(0, 35)}..."`
                });
            }
        }
    }
}

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, phone, fullName, password } = req.body;
        if (!username || !fullName || !password) return res.status(400).json({ error: 'Please fill in all required fields!' });
        if (!isStrongPassword(password)) return res.status(400).json({ error: 'Password must be 8+ chars with letters, numbers & symbols.' });

        const usernameExists = await User.findOne({ username: new RegExp(`^${username.trim()}$`, 'i') });
        if (usernameExists) return res.status(400).json({ error: 'Minion Name is already taken!' });

        if (email && email.trim()) {
            const emailExists = await User.findOne({ email: new RegExp(`^${email.trim()}$`, 'i') });
            if (emailExists) return res.status(400).json({ error: 'Email already registered! Please log in.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            username: username.trim(),
            fullName: fullName.trim(),
            email: email ? email.trim().toLowerCase() : '',
            phone: phone ? phone.trim() : '',
            password: hashedPassword
        });
        await newUser.save();
        req.session.userId = newUser._id;
        res.json({ message: 'Welcome to Gru’s Crew! You can now log in.' });
    } catch (err) {
        res.status(500).json({ error: 'Server error during registration' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

        const user = await User.findOne({
            $or: [{ username: new RegExp(`^${username.trim()}$`, 'i') }, { email: new RegExp(`^${username.trim()}$`, 'i') }]
        });
        if (!user) return res.status(400).json({ error: 'Minion not found!' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Incorrect Banana Code!' });

        req.session.userId = user._id;
        res.json({ message: 'Login successful!' });
    } catch (err) {
        res.status(500).json({ error: 'Server error logging in' });
    }
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        const user = await User.findById(req.session.userId).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: 'Logged out.' }));
});

// --- PASSWORD RESET ROUTES ---
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Please enter your email.' });

        const user = await User.findOne({ email: new RegExp(`^${email.trim()}$`, 'i') });
        if (!user) return res.status(404).json({ error: 'No account found with this email!' });

        const token = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000;
        await user.save();

        const host = req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const resetUrl = `${protocol}://${host}/reset-password.html?token=${token}`;

        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            await transporter.sendMail({
                to: user.email,
                from: process.env.EMAIL_USER,
                subject: '🍌 Gru’s Lab: Password Reset Link',
                html: `<p>Bello, ${user.fullName}!</p><p>Reset your password here:</p><p><a href="${resetUrl}">Reset Password</a></p>`
            });
            res.json({ message: 'Password reset link sent to your email!' });
        } else {
            res.json({ message: 'Reset link generated!', resetUrl: resetUrl });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to process request' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required.' });
        if (!isStrongPassword(newPassword)) return res.status(400).json({ error: 'Password must be 8+ chars with letters, numbers, and symbols.' });

        const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) return res.status(400).json({ error: 'Reset link is invalid or has expired!' });

        user.password = await bcrypt.hash(newPassword, 10);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        res.json({ message: 'Banana Code successfully reset! You can now log in.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset password.' });
    }
});

// --- PROFILE & USERS ROUTES ---
app.get('/api/users', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const users = await User.find({}, 'fullName username role avatar');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load users' });
    }
});

app.get('/api/users/:username', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const target = await User.findOne({ username: new RegExp(`^${req.params.username}$`, 'i') }).select('-password');
        if (!target) return res.status(404).json({ error: 'User not found' });

        const me = await User.findById(req.session.userId);
        const isFriend = me.friends && me.friends.includes(target.username);
        const isBlocked = me.blockedUsers && me.blockedUsers.includes(target.username);

        res.json({
            fullName: target.fullName,
            username: target.username,
            email: target.email,
            phone: target.phone,
            bio: target.bio,
            location: target.location,
            role: target.role,
            avatar: target.avatar,
            coverPhoto: target.coverPhoto,
            highScore: target.highScore,
            joinedAt: target.joinedAt,
            friendsCount: target.friends ? target.friends.length : 0,
            isFriend: !!isFriend,
            isBlocked: !!isBlocked
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

app.get('/api/users/:username/friends', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const target = await User.findOne({ username: new RegExp(`^${req.params.username}$`, 'i') });
        if (!target || !target.friends) return res.json([]);
        const friendsList = await User.find({ username: { $in: target.friends } }, 'fullName username avatar role');
        res.json(friendsList);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch friends' });
    }
});

app.post('/api/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { fullName, email, phone, bio, location, role, avatar, coverPhoto } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (fullName) user.fullName = fullName.trim();
        if (phone !== undefined) user.phone = phone.trim();

        if (email && email.trim() && email.trim().toLowerCase() !== (user.email || '').toLowerCase()) {
            const exists = await User.findOne({ email: new RegExp(`^${email.trim()}$`, 'i'), _id: { $ne: user._id } });
            if (exists) return res.status(400).json({ error: 'This email is already in use!' });
            user.email = email.trim().toLowerCase();
        }

        if (bio !== undefined) user.bio = bio;
        if (location !== undefined) user.location = location;
        if (role) user.role = role;
        if (avatar !== undefined) user.avatar = avatar;
        if (coverPhoto !== undefined) user.coverPhoto = coverPhoto;

        await user.save();
        res.json({ message: 'Profile updated!', user });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

app.post('/api/users/:username/friend', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        const target = await User.findOne({ username: new RegExp(`^${req.params.username}$`, 'i') });
        if (!target) return res.status(404).json({ error: 'User not found' });

        if (!me.friends) me.friends = [];
        if (!target.friends) target.friends = [];

        const idx = me.friends.indexOf(target.username);
        let isFriend = false;
        if (idx > -1) {
            me.friends.splice(idx, 1);
            const tIdx = target.friends.indexOf(me.username);
            if (tIdx > -1) target.friends.splice(tIdx, 1);
        } else {
            me.friends.push(target.username);
            target.friends.push(me.username);
            isFriend = true;

            await Notification.create({
                recipient: target.username,
                sender: me.fullName,
                senderUsername: me.username,
                type: 'friend',
                text: `${me.fullName} added you to their Minion crew! 🍌`
            });
        }
        await me.save();
        await target.save();
        res.json({ isFriend, friendsCount: target.friends.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update friendship' });
    }
});

app.post('/api/users/:username/block', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        if (!me.blockedUsers) me.blockedUsers = [];
        const idx = me.blockedUsers.indexOf(req.params.username);
        let isBlocked = false;
        if (idx > -1) {
            me.blockedUsers.splice(idx, 1);
        } else {
            me.blockedUsers.push(req.params.username);
            isBlocked = true;
        }
        await me.save();
        res.json({ isBlocked });
    } catch (err) {
        res.status(500).json({ error: 'Failed to block/unblock user' });
    }
});

app.post('/api/highscore', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { score } = req.body;
        const user = await User.findById(req.session.userId);
        if (user && score > (user.highScore || 0)) {
            user.highScore = score;
            await user.save();
        }
        res.json({ highScore: user ? user.highScore : 0 });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save score' });
    }
});

// --- POSTS ROUTES ---
app.get('/api/posts', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        const blocked = me.blockedUsers || [];
        const posts = await Post.find({ username: { $nin: blocked } }).sort({ createdAt: -1 });
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

app.post('/api/posts', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { text, image } = req.body;
        if (!text && !image) return res.status(400).json({ error: 'Post cannot be empty!' });

        const me = await User.findById(req.session.userId);
        const newPost = new Post({
            author: me.fullName,
            username: me.username,
            text: text || '',
            image: image || '',
            reactions: []
        });
        await newPost.save();
        if (text) await notifyMentions(text, me);
        res.json(newPost);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create post' });
    }
});

app.put('/api/posts/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: 'Text cannot be empty' });

        const me = await User.findById(req.session.userId);
        let post = await Post.findById(req.params.id);
        if (!post) post = await Post.findOne({ id: req.params.id });
        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.username !== me.username) return res.status(403).json({ error: 'Not allowed to edit' });

        post.text = text.trim();
        post.edited = true;
        await post.save();
        res.json(post);
    } catch (err) {
        res.status(500).json({ error: 'Failed to edit post' });
    }
});

app.delete('/api/posts/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        let post = await Post.findById(req.params.id);
        if (!post) post = await Post.findOne({ id: req.params.id });
        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.username !== me.username) return res.status(403).json({ error: 'Not allowed to delete' });

        await post.remove();
        res.json({ message: 'Post deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// TOGGLE REACTION (Prevents infinite spam, records who reacted, allows unlike)
app.post('/api/posts/:id/react', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { type } = req.body;
        const me = await User.findById(req.session.userId);
        if (!me) return res.status(401).json({ error: 'User not found' });

        let post = null;
        if (mongoose.Types.ObjectId.isValid(req.params.id)) {
            post = await Post.findById(req.params.id);
        }
        if (!post) {
            post = await Post.findOne({ id: req.params.id });
        }
        if (!post) return res.status(404).json({ error: 'Post not found' });

        let currentReactions = [];
        if (Array.isArray(post.reactions)) {
            currentReactions = post.reactions;
        } else if (post.reactions && typeof post.reactions === 'object') {
            currentReactions = [];
        }

        const existingIdx = currentReactions.findIndex(r => r.username === me.username);

        if (existingIdx > -1) {
            const existing = currentReactions[existingIdx];
            if (existing.type === type || existing.emoji === type) {
                // Clicked same emoji -> remove (unlike)
                currentReactions.splice(existingIdx, 1);
            } else {
                // Clicked different emoji -> switch
                currentReactions[existingIdx].type = type;
                currentReactions[existingIdx].emoji = type;
            }
        } else {
            // New reaction
            currentReactions.push({
                type: type,
                emoji: type,
                username: me.username,
                fullName: me.fullName
            });
        }

        post.reactions = currentReactions;
        post.markModified('reactions');
        await post.save();

        res.json({ success: true, reactions: post.reactions });
    } catch (err) {
        console.error('Reaction error:', err);
        res.status(500).json({ error: 'Reaction error: ' + err.message });
    }
});

app.post('/api/posts/:id/comment', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { text } = req.body;
        const me = await User.findById(req.session.userId);
        let post = await Post.findById(req.params.id);
        if (!post) post = await Post.findOne({ id: req.params.id });
        if (post && text) {
            post.comments.push({
                author: me.fullName,
                username: me.username,
                text: text.trim()
            });
            await post.save();
            await notifyMentions(text, me);

            if (post.username !== me.username) {
                await Notification.create({
                    recipient: post.username,
                    sender: me.fullName,
                    senderUsername: me.username,
                    type: 'reply',
                    text: `${me.fullName} commented on your post!`
                });
            }
            return res.json(post.comments[post.comments.length - 1]);
        }
        res.status(404).json({ error: 'Post not found' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to comment' });
    }
});

app.put('/api/posts/:postId/comment/:commentId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { text } = req.body;
        const me = await User.findById(req.session.userId);
        let post = await Post.findById(req.params.postId);
        if (!post) post = await Post.findOne({ id: req.params.postId });
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const comment = post.comments.id(req.params.commentId);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (comment.username !== me.username) return res.status(403).json({ error: 'Not allowed' });

        comment.text = text.trim();
        comment.edited = true;
        await post.save();
        res.json(comment);
    } catch (err) {
        res.status(500).json({ error: 'Failed to edit comment' });
    }
});

app.post('/api/posts/:postId/comment/:commentId/reply', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { text } = req.body;
        const me = await User.findById(req.session.userId);
        let post = await Post.findById(req.params.postId);
        if (!post) post = await Post.findOne({ id: req.params.postId });
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const comment = post.comments.id(req.params.commentId);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        if (!comment.replies) comment.replies = [];
        const newReply = {
            author: me.fullName,
            username: me.username,
            text: text.trim()
        };
        comment.replies.push(newReply);
        await post.save();
        await notifyMentions(text, me);

        if (comment.username && comment.username !== me.username) {
            await Notification.create({
                recipient: comment.username,
                sender: me.fullName,
                senderUsername: me.username,
                type: 'reply',
                text: `${me.fullName} replied to your comment!`
            });
        }
        res.json(newReply);
    } catch (err) {
        res.status(500).json({ error: 'Failed to reply' });
    }
});

// --- MESSAGES & CHAT ---
app.get('/api/messages', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        const blocked = me.blockedUsers || [];
        const messages = await Message.find({ username: { $nin: blocked } }).sort({ createdAt: 1 }).limit(50);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.post('/api/messages', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { text, replyTo } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: 'Message empty' });

        const me = await User.findById(req.session.userId);
        const newMsg = new Message({
            sender: me.fullName,
            username: me.username,
            text: text.trim(),
            replyTo: replyTo || ''
        });
        await newMsg.save();
        await notifyMentions(text, me);
        res.json(newMsg);
    } catch (err) {
        res.status(500).json({ error: 'Failed to post message' });
    }
});

app.post('/api/messages/:id/react', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { emoji } = req.body;
        const me = await User.findById(req.session.userId);
        let msg = await Message.findById(req.params.id) || await DM.findById(req.params.id);
        if (!msg) return res.status(404).json({ error: 'Message not found' });

        if (!msg.reactions) msg.reactions = [];
        msg.reactions = msg.reactions.filter(r => r.username !== me.username);
        msg.reactions.push({ emoji, fullName: me.fullName, username: me.username });
        await msg.save();
        res.json({ success: true, reactions: msg.reactions });
    } catch (err) {
        res.status(500).json({ error: 'Failed to react' });
    }
});

// --- PRIVATE DMs ---
app.get('/api/dms', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        const dms = await DM.find({ $or: [{ sender: me.username }, { recipient: me.username }] });
        const partnerUsernames = new Set();
        dms.forEach(d => {
            if (d.sender !== me.username) partnerUsernames.add(d.sender);
            if (d.recipient !== me.username) partnerUsernames.add(d.recipient);
        });
        const partners = await User.find({ username: { $in: Array.from(partnerUsernames) } }, 'fullName username avatar');
        res.json(partners);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

app.get('/api/dm/:username', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        const target = req.params.username;
        const thread = await DM.find({
            $or: [{ sender: me.username, recipient: target }, { sender: target, recipient: me.username }]
        }).sort({ createdAt: 1 });
        res.json(thread);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch thread' });
    }
});

app.post('/api/dm/:username', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { text, replyTo } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: 'Message empty' });

        const me = await User.findById(req.session.userId);
        const recipient = await User.findOne({ username: new RegExp(`^${req.params.username}$`, 'i') });
        if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

        const newDM = new DM({
            sender: me.username,
            recipient: recipient.username,
            text: text.trim(),
            replyTo: replyTo || ''
        });
        await newDM.save();

        await Notification.create({
            recipient: recipient.username,
            sender: me.fullName,
            senderUsername: me.username,
            type: 'dm',
            text: `💬 New message from ${me.fullName}`
        });

        res.json(newDM);
    } catch (err) {
        res.status(500).json({ error: 'Failed to send DM' });
    }
});

// --- NOTIFICATIONS ---
app.get('/api/notifications', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        const notifs = await Notification.find({ recipient: me.username }).sort({ createdAt: -1 }).limit(30);
        res.json(notifs);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

app.post('/api/notifications/read', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await User.findById(req.session.userId);
        await Notification.updateMany({ recipient: me.username, read: false }, { read: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to mark read' });
    }
});

app.listen(PORT, () => console.log(`🚀 MinionFeed running on port ${PORT}`));