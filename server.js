const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'users.json');
const POSTS_FILE = path.join(__dirname, 'posts.json');

// Initialize files
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));
if (!fs.existsSync(POSTS_FILE)) {
    const starterPosts = [
        {
            id: 1,
            author: 'Kevin the Minion',
            username: 'kevin',
            text: 'Just finished polishing the rocket! Anyone seen Bob? ????',
            image: 'https://media.giphy.com/media/11sBLVxNs7v6WA/giphy.gif',
            reactions: { banana: 12, love: 5, haha: 8, rocket: 4 },
            comments: [
                { id: 101, author: 'Stuart', text: 'Bob is looking for his teddy bear! ??', time: '5m ago' }
            ],
            time: '15 mins ago'
        }
    ];
    fs.writeFileSync(POSTS_FILE, JSON.stringify(starterPosts, null, 2));
}

function getUsers() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}
function saveUsers(users) {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

function getPosts() {
    try { return JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8')); } catch { return []; }
}
function savePosts(posts) {
    fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
}

// Allow larger payloads for pasted images (Base64)
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'my-desktop-website-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }
}));

// Auth Routes
app.post('/api/register', async (req, res) => {
    const { fullName, email, phone, username, password } = req.body;
    if (!fullName || !email || !phone || !username || !password) {
        return res.status(400).json({ error: 'Please fill in all details!' });
    }

    const users = getUsers();
    if (users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ error: 'Minion Name already taken!' });
    }
    if (users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase())) {
        return res.status(400).json({ error: 'Email already registered!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({
        id: Date.now(),
        fullName,
        email,
        phone,
        username,
        password: hashedPassword,
        highScore: 0,
        joinedAt: new Date().toLocaleDateString()
    });
    saveUsers(users);
    res.json({ message: 'Welcome to Gru’s Crew! You can now log in.' });
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
        highScore: user.highScore || 0,
        joinedAt: user.joinedAt || 'Unknown'
    });
});

// Save Game Highscore
app.post('/api/highscore', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { score } = req.body;
    const users = getUsers();
    const user = users.find(u => u.id === req.session.userId);

    if (user) {
        if (!user.highScore || score > user.highScore) {
            user.highScore = score;
            saveUsers(users);
        }
        return res.json({ highScore: user.highScore });
    }
    res.status(404).json({ error: 'User not found' });
});

// --- FEED & SOCIAL ROUTES ---

// 1. Get posts
app.get('/api/posts', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    res.json(getPosts());
});

// 2. Create post
app.post('/api/posts', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { text, image } = req.body;
    if (!text && !image) return res.status(400).json({ error: 'Post cannot be empty!' });

    const users = getUsers();
    const currentUser = users.find(u => u.id === req.session.userId);
    const posts = getPosts();

    const newPost = {
        id: Date.now(),
        author: currentUser ? currentUser.fullName : 'Anonymous Minion',
        username: currentUser ? currentUser.username : 'minion',
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

// 3. React to post (Banana, Love, Haha, Rocket)
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

// 4. Add Comment
app.post('/api/posts/:id/comment', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const postId = Number(req.params.id);
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Empty comment' });

    const users = getUsers();
    const currentUser = users.find(u => u.id === req.session.userId);
    const posts = getPosts();
    const post = posts.find(p => p.id === postId);

    if (post) {
        if (!post.comments) post.comments = [];
        const newComment = {
            id: Date.now(),
            author: currentUser ? currentUser.fullName : 'Minion',
            text: text,
            time: 'Just now'
        };
        post.comments.push(newComment);
        savePosts(posts);
        return res.json(newComment);
    }
    res.status(404).json({ error: 'Post not found' });
});

// 5. Share / Repost
app.post('/api/posts/:id/share', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const postId = Number(req.params.id);
    const users = getUsers();
    const currentUser = users.find(u => u.id === req.session.userId);
    const posts = getPosts();
    const original = posts.find(p => p.id === postId);

    if (original) {
        const sharedPost = {
            id: Date.now(),
            author: currentUser ? currentUser.fullName : 'Minion',
            username: currentUser ? currentUser.username : 'minion',
            text: `?? Reposted from ${original.author}: "${original.text}"`,
            image: original.image,
            reactions: { banana: 1, love: 0, haha: 0, rocket: 0 },
            comments: [],
            time: 'Just now'
        };
        posts.unshift(sharedPost);
        savePosts(posts);
        return res.json(sharedPost);
    }
    res.status(404).json({ error: 'Post not found' });
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: 'Logged out.' }));
});

app.listen(PORT, () => {
    console.log(`Server is running! Open your browser to: http://localhost:${PORT}`);
});