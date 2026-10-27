document.addEventListener('DOMContentLoaded', () => {
    // Check session on load
    checkAuthStatus();

    // DOM Elements
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const messageForm = document.getElementById('messageForm');
    const errorMessageEl = document.getElementById('errorMessage');

    // -------------------------------------------------------------
    // AUTHENTICATION
    // -------------------------------------------------------------

    // Register User
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();

            const fullName = document.getElementById('regFullName')?.value;
            const username = document.getElementById('regUsername')?.value;
            const password = document.getElementById('regPassword')?.value;

            try {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fullName, username, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    showError(data.error || 'Registration failed');
                    return;
                }

                // Redirect or reload on success
                window.location.href = '/dashboard.html';
            } catch (err) {
                console.error('Registration fetch error:', err);
                showError('Network error! Could not connect to server.');
            }
        });
    }

    // Log In User
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();

            const username = document.getElementById('loginUsername')?.value;
            const password = document.getElementById('loginPassword')?.value;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    // Displays specific errors like "User not found" or "Incorrect password"
                    showError(data.error || 'Login failed');
                    return;
                }

                window.location.href = '/dashboard.html';
            } catch (err) {
                console.error('Login fetch error:', err);
                showError('Network error! Could not connect to server.');
            }
        });
    }

    // Check Login Status
    async function checkAuthStatus() {
        try {
            const res = await fetch('/api/me');
            if (res.ok) {
                const user = await res.json();
                console.log('Logged in as:', user.username);
                loadMessages();
            }
        } catch (err) {
            console.log('User not logged in');
        }
    }

    // -------------------------------------------------------------
    // MESSAGES & EMOJI REACTIONS
    // -------------------------------------------------------------

    // Load Public Feed Messages
    async function loadMessages() {
        const feedContainer = document.getElementById('messageFeed');
        if (!feedContainer) return;

        try {
            const res = await fetch('/api/messages');
            const messages = await res.json();

            feedContainer.innerHTML = '';
            messages.forEach(msg => {
                const msgCard = renderMessageCard(msg);
                feedContainer.appendChild(msgCard);
            });
        } catch (err) {
            console.error('Failed to load messages:', err);
        }
    }

    // Render Single Message Card with Reaction Buttons
    function renderMessageCard(msg) {
        const card = document.createElement('div');
        card.className = 'message-card';
        card.dataset.id = msg._id;

        // Count reactions by emoji type
        const reactionCounts = (msg.reactions || []).reduce((acc, curr) => {
            acc[curr.emoji] = (acc[curr.emoji] || 0) + 1;
            return acc;
        }, {});

        const reactionBadges = Object.entries(reactionCounts)
            .map(([emoji, count]) => `<span class="badge">${emoji} ${count}</span>`)
            .join(' ');

        card.innerHTML = `
            <div class="msg-header">
                <strong>${escapeHtml(msg.sender)}</strong> <small>@${escapeHtml(msg.username)}</small>
            </div>
            <p class="msg-text">${escapeHtml(msg.text)}</p>
            <div class="reactions-container" id="reactions-${msg._id}">
                ${reactionBadges}
            </div>
            <div class="msg-actions">
                <button onclick="reactToMessage('${msg._id}', '🍌')">🍌</button>
                <button onclick="reactToMessage('${msg._id}', '🔥')">🔥</button>
                <button onclick="reactToMessage('${msg._id}', '❤️')">❤️</button>
                <button onclick="reactToMessage('${msg._id}', '😂')">😂</button>
            </div>
        `;
        return card;
    }

    // Send Message
    if (messageForm) {
        messageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const textInput = document.getElementById('messageText');
            if (!textInput.value.trim()) return;

            try {
                const res = await fetch('/api/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: textInput.value })
                });

                if (res.ok) {
                    textInput.value = '';
                    loadMessages();
                }
            } catch (err) {
                console.error('Error posting message:', err);
            }
        });
    }

    // Helper utilities
    function showError(msg) {
        if (errorMessageEl) {
            errorMessageEl.textContent = msg;
            errorMessageEl.style.display = 'block';
        }
    }

    function clearError() {
        if (errorMessageEl) {
            errorMessageEl.textContent = '';
            errorMessageEl.style.display = 'none';
        }
    }

    function escapeHtml(text) {
        return text
            ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            : '';
    }
});

// Global Function for Click Handlers on Reactions
async function reactToMessage(messageId, emoji) {
    try {
        const res = await fetch(`/api/messages/${messageId}/react`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            // Update reaction display dynamically
            const container = document.getElementById(`reactions-${messageId}`);
            if (container) {
                const counts = data.reactions.reduce((acc, curr) => {
                    acc[curr.emoji] = (acc[curr.emoji] || 0) + 1;
                    return acc;
                }, {});

                container.innerHTML = Object.entries(counts)
                    .map(([e, count]) => `<span class="badge">${e} ${count}</span>`)
                    .join(' ');
            }
        }
    } catch (err) {
        console.error('Failed to submit reaction:', err);
    }
}
