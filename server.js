const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'users.json');
const POSTS_FILE = path.join(__dirname, 'posts.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Initialize files
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));
if (!fs.existsSync(POSTS_FILE)) {
    const starterPosts = [
        {
            id: 1,
            author: 'Kevin the Minion',
            username: 'kevin',
            text: 'Just finished polishing the moon rocket! Anyone seen Bob? 🚀🍌',
            image: 'https://media.giphy.com/media/11sBLVxNs7v6WA/giphy.gif',
            reactions: { banana: 12, love: 5, haha: 8, rocket: 4 },
            comments: [{ id: 101, author: 'Stuart', text: 'Bob is looking for his teddy bear! 😂' }],
            time: '15 mins ago'
        }
    ];
    fs.writeFileSync(POSTS_FILE, JSON.stringify(starterPosts, null, 2));
}
if (!fs.existsSync(MESSAGES_FILE)) {
    const starterMessages = [
        { id: 1, sender: 'Kevin', text: 'Bello everyone! Welcome to Gru\'s Secret Chatroom! 🧪', time: '10:00 AM' },
        { id: 2, sender: 'Stuart', text: 'Bananaaaaa! 🍌', time: '10:02 AM' }
    ];
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(starterMessages, null, 2));
}

function getUsers() { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } }
function saveUsers(u) { fs.writeFileSync(DB_FILE, JSON.stringify(u, null, 2)); }
function getPosts() { try { return JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8')); } catch { return []; } }
function savePosts(p) { fs.writeFileSync(POSTS_FILE, JSON.stringify(p, null, 2)); }
function getMessages() { try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; } }
function saveMessages(m) { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(m, null, 2)); }

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'my-desktop-website-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
    const { fullName, email, phone, username, password } = req.body;
    if (!fullName || !email || !phone || !username || !password) return res.status(400).json({ error: 'Fill in all fields!' });

    const users = getUsers();
    if (users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Username taken!' });
    if (users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already registered!' });

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({
        id: Date.now(),
        fullName,
        email,
        phone,
        username,
        password: hashedPassword,
        bio: 'Official Minion ready to cause mischief! 🍌',
        role: 'Rocket Scientist',
        avatar: '🍌',
        highScore: 0,
        joinedAt: new Date().toLocaleDateString()
    });
    saveUsers(users);
    res.json({ message: 'Welcome to Gru’s Crew! You can log in.' });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = getUsers();
    const user = users.find(u => 
        (u.username && u.username.toLowerCase() === username.toLowerCase()) || 
        (u.email && u.email.toLowerCase() === username.toLowerCase())
    );

    if (!user) return res.status(400).json({ error: 'Minion not found!' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Incorrect Banana Code!' });

    req.session.userId = user.id;
    res.json({ message: 'Login successful!' });
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const users = getUsers();
    const user = users.find(u => u.id === req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
        fullName: user.fullName || user.username,
        email: user.email || 'None',
        phone: user.phone || 'None',
        username: user.username,
        bio: user.bio || 'Proud Minion',
        role: user.role || 'Agent',
        avatar: user.avatar || '🍌',
        highScore: user.highScore || 0,
        joinedAt: user.joinedAt || 'Recently'
    });
});

// Update Profile
app.post('/api/profile', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { fullName, bio, role, avatar } = req.body;
    const users = getUsers();
    const user = users.find(u => u.id === req.session.userId);

    if (user) {
        if (fullName) user.fullName = fullName;
        if (bio) user.bio = bio;
        if (role) user.role = role;
        if (avatar) user.avatar = avatar;
        saveUsers(users);
        return res.json({ message: 'Profile updated!', user });
    }
    res.status(404).json({ error: 'User not found' });
});

// High score
app.post('/api/highscore', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { score } = req.body;
    const users = getUsers();
    const user = users.find(u => u.id === req.session.userId);
    if (user && (!user.highScore || score > user.highScore)) {
        user.highScore = score;
        saveUsers(users);
    }
    res.json({ highScore: user ? user.highScore : 0 });
});

// --- MESSAGES / CHATROOM ROUTES ---
app.get('/api/messages', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    res.json(getMessages());
});

app.post('/api/messages', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message empty' });

    const users = getUsers();
    const user = users.find(u => u.id === req.session.userId);
    const messages = getMessages();

    const newMsg = {
        id: Date.now(),
        sender: user ? user.fullName : 'Minion',
        avatar: user ? (user.avatar || '🍌') : '🍌',
        text: text.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    messages.push(newMsg);
    // Keep last 50 messages so it doesn't get bloated
    if (messages.length > 50) messages.shift();
    saveMessages(messages);
    res.json(newMsg);
});

// --- POSTS ROUTES ---
app.get('/api/posts', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    res.json(getPosts());
});

app.post('/api/posts', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text, image } = req.body;
    if (!text && !image) return res.status(400).json({ error: 'Post empty' });

    const users = getUsers();
    const user = users.find(u => u.id === req.session.userId);
    const posts = getPosts();

    const newPost = {
        id: Date.now(),
        author: user ? user.fullName : 'Minion',
        username: user ? user.username : 'minion',
        text: text || '',
        image: image || '',
        reactions: { banana: 1, love: 0, haha: 0, rocket: 0 },
        comments: [],
        time: 'Just now'
    };
    posts.unshift(newPost);
    savePosts(posts);
    res.json(newPost);
});

app.post('/api/posts/:id/react', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const postId = Number(req.params.id);
    const { type } = req.body;
    const posts = getPosts();
    const post = posts.find(p => p.id === postId);
    if (post) {
        if (!post.reactions) post.reactions = { banana: 0, love: 0, haha: 0, rocket: 0 };
        post.reactions[type] = (post.reactions[type] || 0) + 1;
        savePosts(posts);
        return res.json({ reactions: post.reactions });
    }
    res.status(404).json({ error: 'Post not found' });
});

app.post('/api/posts/:id/comment', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const postId = Number(req.params.id);
    const { text } = req.body;
    const users = getUsers();
    const user = users.find(u => u.id === req.session.userId);
    const posts = getPosts();
    const post = posts.find(p => p.id === postId);
    if (post && text) {
        if (!post.comments) post.comments = [];
        const newComment = { id: Date.now(), author: user ? user.fullName : 'Minion', text };
        post.comments.push(newComment);
        savePosts(posts);
        return res.json(newComment);
    }
    res.status(404).json({ error: 'Post not found' });
});

app.post('/api/posts/:id/share', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const postId = Number(req.params.id);
    const users = getUsers();
    const user = users.find(u => u.id === req.session.userId);
    const posts = getPosts();
    const orig = posts.find(p => p.id === postId);
    if (orig) {
        const shared = {
            id: Date.now(),
            author: user ? user.fullName : 'Minion',
            username: user ? user.username : 'minion',
            text: `🔁 Reposted from ${orig.author}: "${orig.text}"`,
            image: orig.image,
            reactions: { banana: 1, love: 0, haha: 0, rocket: 0 },
            comments: [],
            time: 'Just now'
        };
        posts.unshift(shared);
        savePosts(posts);
        return res.json(shared);
    }
    res.status(404).json({ error: 'Post not found' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: 'Logged out.' }));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
