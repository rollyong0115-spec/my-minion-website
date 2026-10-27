const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { Resend } = require('resend');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

app.set('trust proxy', 1);

if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ Connected to MongoDB Cloud Database!'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
} else {
    console.warn('⚠️ MONGO_URI not set!');
}

const resend = new Resend(process.env.RESEND_API_KEY);

// --- DATABASE SCHEMAS ---
const UserSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: String,
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bio: { type: String, default: 'Living life one banana at a time! 🍌' },
    location: { type: String, default: "Gru's Secret Lab" },
    role: { type: String, default: 'Rocket Scientist' },
    avatar: { type: String, default: '' },
    coverPhoto: { type: String, default: '' },
    highScore: { type: Number, default: 0 },
    friends: [{ type: String }],
    friendRequests: [{ type: String }],
    sentRequests: [{ type: String }],
    blockedUsers: [{ type: String }],
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    joinedAt: { type: String, default: () => new Date().toLocaleDateString() }
});

const NotificationSchema = new mongoose.Schema({
    recipient: { type: String, required: true },
    sender: { type: String, required: true },
    senderUsername: { type: String, required: true },
    type: { type: String, required: true },
    text: { type: String, required: true },
    postId: { type: mongoose.Schema.Types.ObjectId, default: null },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const CommentSchema = new mongoose.Schema({
    author: String,
    username: String,
    text: String,
    createdAt: { type: Date, default: Date.now },
    edited: { type: Boolean, default: false },
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
    reactions: {
        banana: { type: Number, default: 0 },
        love: { type: Number, default: 0 },
        haha: { type: Number, default: 0 },
        rocket: { type: Number, default: 0 }
    },
    comments: [CommentSchema],
    createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
    sender: String,
    username: String,
    avatar: String,
    text: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const Post = mongoose.model('Post', PostSchema);
const Message = mongoose.model('Message', MessageSchema);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
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

// --- CASE-INSENSITIVE MENTION MATCHING ---
async function notifyMentions(text, sender, postId = null) {
    if (!text) return;
    const matches = text.match(/@([a-zA-Z0-9_]+)/g);
    if (!matches) return;
    for (let m of matches) {
        const queryVal = m.replace('@', '').trim();
        if (queryVal.toLowerCase() !== sender.username.toLowerCase()) {
            const userExists = await User.findOne({
                $or: [
                    { username: { $regex: new RegExp(`^${queryVal}`, 'i') } },
                    { fullName: { $regex: new RegExp(`^${queryVal}`, 'i') } }
                ]
            });
            if (userExists) {
                await Notification.create({
                    recipient: userExists.username,
                    sender: sender.fullName,
                    senderUsername: sender.username,
                    type: 'mention',
                    text: `${sender.fullName} mentioned you: "${text.substring(0, 40)}..."`,
                    postId: postId
                });
            }
        }
    }
}

// --- AUTH & USER ROUTES ---
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, phone, username, password } = req.body;
        if (!fullName || !email || !phone || !username || !password) return res.status(400).json({ error: 'Please fill in all details!' });
        if (!isStrongPassword(password)) return res.status(400).json({ error: 'Password must be 8+ chars with letters, numbers & symbols.' });

        const usernameExists = await User.findOne({ username: new RegExp(`^${username.trim()}$`, 'i') });
        if (usernameExists) return res.status(400).json({ error: 'Minion Name already taken!' });

        const emailExists = await User.findOne({ email: new RegExp(`^${email.trim()}$`, 'i') });
        if (emailExists) return res.status(400).json({ error: 'Email already registered!' });

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
        location: user.location,
        role: user.role,
        avatar: user.avatar,
        coverPhoto: user.coverPhoto,
        highScore: user.highScore,
        friends: user.friends || [],
        friendRequests: user.friendRequests || [],
        sentRequests: user.sentRequests || [],
        blockedUsers: user.blockedUsers || [],
        joinedAt: user.joinedAt
    });
});

app.get('/api/users/:username', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const targetUser = await User.findOne({ username: new RegExp(`^${req.params.username}$`, 'i') });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    const currentUser = await User.findById(req.session.userId);
    const isFriend = currentUser.friends && currentUser.friends.includes(targetUser.username);
    const requestSent = currentUser.sentRequests && currentUser.sentRequests.includes(targetUser.username);
    const requestReceived = currentUser.friendRequests && currentUser.friendRequests.includes(targetUser.username);
    const isBlocked = currentUser.blockedUsers && currentUser.blockedUsers.includes(targetUser.username);

    res.json({
        fullName: targetUser.fullName,
        username: targetUser.username,
        bio: targetUser.bio,
        location: targetUser.location,
        role: targetUser.role,
        avatar: targetUser.avatar,
        coverPhoto: targetUser.coverPhoto,
        highScore: targetUser.highScore,
        joinedAt: targetUser.joinedAt,
        isFriend: !!isFriend,
        requestSent: !!requestSent,
        requestReceived: !!requestReceived,
        isBlocked: !!isBlocked
    });
});

app.get('/api/users', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const users = await User.find({}, 'fullName username role avatar');
    res.json(users);
});

// --- FRIEND REQUEST WORKFLOW ---
app.post('/api/users/:username/friend', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const currentUser = await User.findById(req.session.userId);
    const targetUser = await User.findOne({ username: new RegExp(`^${req.params.username}$`, 'i') });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    const targetUsername = targetUser.username;
    if (currentUser.username === targetUsername) return res.status(400).json({ error: 'Cannot friend yourself' });

    if (!currentUser.friends) currentUser.friends = [];
    if (!currentUser.sentRequests) currentUser.sentRequests = [];
    if (!targetUser.friendRequests) targetUser.friendRequests = [];

    if (currentUser.friends.includes(targetUsername)) {
        currentUser.friends = currentUser.friends.filter(u => u !== targetUsername);
        targetUser.friends = targetUser.friends.filter(u => u !== currentUser.username);
    } else if (currentUser.sentRequests.includes(targetUsername)) {
        currentUser.sentRequests = currentUser.sentRequests.filter(u => u !== targetUsername);
        targetUser.friendRequests = targetUser.friendRequests.filter(u => u !== currentUser.username);
    } else {
        currentUser.sentRequests.push(targetUsername);
        targetUser.friendRequests.push(currentUser.username);

        await Notification.create({
            recipient: targetUsername,
            sender: currentUser.fullName,
            senderUsername: currentUser.username,
            type: 'friend_request',
            text: `${currentUser.fullName} sent you a Minion crew request! 🍌`
        });
    }

    await currentUser.save();
    await targetUser.save();
    res.json({ 
        isFriend: currentUser.friends.includes(targetUsername), 
        requestSent: currentUser.sentRequests.includes(targetUsername) 
    });
});

app.post('/api/users/:username/accept-friend', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const currentUser = await User.findById(req.session.userId);
    const senderUser = await User.findOne({ username: new RegExp(`^${req.params.username}$`, 'i') });
    if (!senderUser) return res.status(404).json({ error: 'User not found' });

    const senderUsername = senderUser.username;

    currentUser.friendRequests = (currentUser.friendRequests || []).filter(u => u !== senderUsername);
    senderUser.sentRequests = (senderUser.sentRequests || []).filter(u => u !== currentUser.username);

    if (!currentUser.friends) currentUser.friends = [];
    if (!currentUser.friends.includes(senderUsername)) currentUser.friends.push(senderUsername);

    if (!senderUser.friends) senderUser.friends = [];
    if (!senderUser.friends.includes(currentUser.username)) senderUser.friends.push(currentUser.username);

    await currentUser.save();
    await senderUser.save();

    await Notification.create({
        recipient: senderUsername,
        sender: currentUser.fullName,
        senderUsername: currentUser.username,
        type: 'friend_accepted',
        text: `${currentUser.fullName} accepted your Minion crew request! 🎉`
    });

    res.json({ success: true });
});

app.post('/api/users/:username/decline-friend', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const currentUser = await User.findById(req.session.userId);
    const senderUser = await User.findOne({ username: new RegExp(`^${req.params.username}$`, 'i') });
    if (!senderUser) return res.status(404).json({ error: 'User not found' });

    const senderUsername = senderUser.username;

    currentUser.friendRequests = (currentUser.friendRequests || []).filter(u => u !== senderUsername);
    senderUser.sentRequests = (senderUser.sentRequests || []).filter(u => u !== currentUser.username);

    await currentUser.save();
    await senderUser.save();

    res.json({ success: true });
});

app.post('/api/users/:username/block', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const currentUser = await User.findById(req.session.userId);
    const targetUsername = req.params.username;

    if (!currentUser.blockedUsers) currentUser.blockedUsers = [];
    const idx = currentUser.blockedUsers.indexOf(targetUsername);

    let isBlocked = false;
    if (idx > -1) {
        currentUser.blockedUsers.splice(idx, 1);
    } else {
        currentUser.blockedUsers.push(targetUsername);
        isBlocked = true;
    }
    await currentUser.save();
    res.json({ isBlocked });
});

app.post('/api/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { fullName, email, phone, bio, location, role, avatar, coverPhoto } = req.body;
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (fullName) user.fullName = fullName.trim();
    if (phone !== undefined) user.phone = phone.trim();

    if (email && email.trim().toLowerCase() !== user.email.toLowerCase()) {
        const emailExists = await User.findOne({
            email: new RegExp(`^${email.trim()}$`, 'i'),
            _id: { $ne: user._id }
        });
        if (emailExists) {
            return res.status(400).json({ error: 'This email is already in use by another Minion!' });
        }
        user.email = email.trim().toLowerCase();
    }

    if (bio !== undefined) user.bio = bio;
    if (location !== undefined) user.location = location;
    if (role) user.role = role;
    if (avatar !== undefined) user.avatar = avatar;
    if (coverPhoto !== undefined) user.coverPhoto = coverPhoto;

    await user.save();
    return res.json({ message: 'Profile updated!', user });
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

// --- NOTIFICATIONS & MESSAGES & POSTS ---
app.get('/api/notifications', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const notifications = await Notification.find({ recipient: user.username }).sort({ createdAt: -1 }).limit(25);
    res.json(notifications);
});

app.post('/api/notifications/read', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findById(req.session.userId);
    if (user) await Notification.updateMany({ recipient: user.username, read: false }, { read: true });
    res.json({ success: true });
});

app.get('/api/messages', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const currentUser = await User.findById(req.session.userId);
    const blocked = currentUser.blockedUsers || [];
    const messages = await Message.find({ username: { $nin: blocked } }).sort({ createdAt: 1 }).limit(50);
    res.json(messages);
});

app.post('/api/messages', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message empty' });

    const user = await User.findById(req.session.userId);
    const newMsg = new Message({
        sender: user ? user.fullName : 'Minion',
        username: user ? user.username : 'minion',
        avatar: user && user.avatar ? user.avatar : '🍌',
        text: text.trim()
    });
    await newMsg.save();
    await notifyMentions(text, user, null);
    res.json(newMsg);
});

app.get('/api/posts', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const currentUser = await User.findById(req.session.userId);
    const blocked = currentUser.blockedUsers || [];
    let posts = await Post.find({ username: { $nin: blocked } }).sort({ createdAt: -1 });
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
    if (text) await notifyMentions(text, user, newPost._id);
    res.json(newPost);
});

app.put('/api/posts/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text cannot be empty' });

    const user = await User.findById(req.session.userId);
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.username !== user.username) return res.status(403).json({ error: 'Not allowed to edit' });

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
        const newComment = {
            author: user ? user.fullName : 'Minion',
            username: user ? user.username : 'minion',
            text: text.trim()
        };
        post.comments.push(newComment);
        await post.save();
        await notifyMentions(text, user, post._id);

        if (post.username !== user.username) {
            await Notification.create({
                recipient: post.username,
                sender: user.fullName,
                senderUsername: user.username,
                type: 'reply',
                text: `${user.fullName} commented on your post!`,
                postId: post._id
            });
        }
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
    if (post.comments.id(req.params.commentId).username !== user.username) return res.status(403).json({ error: 'Not allowed' });

    const comment = post.comments.id(req.params.commentId);
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
    if (!comment.replies) comment.replies = [];
    const newReply = {
        author: user ? user.fullName : 'Minion',
        username: user ? user.username : 'minion',
        text: text.trim()
    };
    comment.replies.push(newReply);
    await post.save();
    await notifyMentions(text, user, post._id);

    if (comment.username && comment.username !== user.username) {
        await Notification.create({
            recipient: comment.username,
            sender: user.fullName,
            senderUsername: user.username,
            type: 'reply',
            text: `${user.fullName} replied to your comment!`,
            postId: post._id
        });
    }
    res.json(newReply);
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: 'Logged out.' }));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
