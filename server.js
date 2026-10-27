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
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
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
    username: String,
    avatar: String,
    text: String,
    time: String,
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

async function notifyMentions(text, sender) {
    const matches = text.match(/@([a-zA-Z0-9_]+)/g);
    if (!matches) return;
    for (let m of matches) {
        const username = m.replace('@', '').toLowerCase();
        if (username !== sender.username.toLowerCase()) {
            const userExists = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
            if (userExists) {
                await Notification.create({
                    recipient: userExists.username,
                    sender: sender.fullName,
                    senderUsername: sender.username,
                    type: 'mention',
                    text: `${sender.fullName} mentioned you: "${text.substring(0, 40)}..."`
                });
            }
        }
    }
}

// --- FORGOT & RESET PASSWORD ---
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Please enter your email.' });

        const user = await User.findOne({ email: new RegExp(`^${email.trim()}$`, 'i') });
        if (!user) return res.status(404).json({ error: 'No account found with this email!' });

        const token = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
        await user.save();

        const host = req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const resetUrl = `${protocol}://${host}/reset-password.html?token=${token}`;

        // Send real email via Resend Web API
        const { data, error } = await resend.emails.send({
            from: 'Gru\'s Lab <onboarding@resend.dev>',
            to: [user.email],
            subject: '🍌 Gru’s Lab: Password Reset Link',
            html: `
                <h2>Password Reset Request</h2>
                <p>Bello, ${user.fullName}!</p>
                <p>Click the link below to set a new Banana Code password:</p>
                <p><a href="${resetUrl}" style="background:#fedb00;color:#1e3a8a;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password Now</a></p>
                <p>This link expires in 1 hour.</p>
            `
        });

        if (error) {
            console.error('Resend Error:', error);
            return res.status(500).json({ error: 'Failed to send reset email.' });
        }

        res.json({ message: 'Password reset link sent! Check your inbox 📧' });
    } catch (err) {
        console.error('Server catch error:', err);
        res.status(500).json({ error: 'Server error processing request.' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required.' });

        if (!isStrongPassword(newPassword)) {
            return res.status(400).json({ error: 'Password must be 8+ chars with letters, numbers, and symbols.' });
        }

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) return res.status(400).json({ error: 'Password reset link is invalid or has expired!' });

        user.password = await bcrypt.hash(newPassword, 10);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ message: 'Banana Code successfully reset! You can now log in.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset password.' });
    }
});

// --- NOTIFICATION ROUTES ---
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
        isBlocked: !!isBlocked
    });
});

app.get('/api/users', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const users = await User.find({}, 'fullName username role avatar');
    res.json(users);
});

app.post('/api/users/:username/friend', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const currentUser = await User.findById(req.session.userId);
    const targetUsername = req.params.username;

    if (!currentUser.friends) currentUser.friends = [];
    const idx = currentUser.friends.indexOf(targetUsername);

    let isFriend = false;
    if (idx > -1) {
        currentUser.friends.splice(idx, 1);
    } else {
        currentUser.friends.push(targetUsername);
        isFriend = true;
        await Notification.create({
            recipient: targetUsername,
            sender: currentUser.fullName,
            senderUsername: currentUser.username,
            type: 'friend',
            text: `${currentUser.fullName} added you to their Minion crew! 🍌`
        });
    }
    await currentUser.save();
    res.json({ isFriend });
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

// --- MESSAGES ---
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
        text: text.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    await newMsg.save();
    await notifyMentions(text, user);
    res.json(newMsg);
});

// --- POSTS ---
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
    if (text) await notifyMentions(text, user);
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
        post.comments.push({
            author: user ? user.fullName : 'Minion',
            username: user ? user.username : 'minion',
            text: text.trim(),
            time: 'Just now'
        });
        await post.save();
        await notifyMentions(text, user);

        if (post.username !== user.username) {
            await Notification.create({
                recipient: post.username,
                sender: user.fullName,
                senderUsername: user.username,
                type: 'reply',
                text: `${user.fullName} commented on your post!`
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
        text: text.trim(),
        time: 'Just now'
    };
    comment.replies.push(newReply);
    await post.save();
    await notifyMentions(text, user);

    if (comment.username && comment.username !== user.username) {
        await Notification.create({
            recipient: comment.username,
            sender: user.fullName,
            senderUsername: user.username,
            type: 'reply',
            text: `${user.fullName} replied to your comment!`
        });
    }
    res.json(newReply);
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: 'Logged out.' }));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
