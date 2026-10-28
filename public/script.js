document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const messageForm = document.getElementById('messageForm');
    
    // Error element container setup
    let errorMessageEl = document.getElementById('errorMessage');
    if (!errorMessageEl) {
        errorMessageEl = document.createElement('div');
        errorMessageEl.id = 'errorMessage';
        errorMessageEl.style.color = 'red';
        errorMessageEl.style.textAlign = 'center';
        errorMessageEl.style.marginTop = '10px';
        const targetContainer = registerForm || loginForm;
        if (targetContainer) targetContainer.appendChild(errorMessageEl);
    }

    function showError(msg) {
        if (errorMessageEl) {
            errorMessageEl.textContent = msg || 'An error occurred';
            errorMessageEl.style.display = 'block';
        }
    }

    function clearError() {
        if (errorMessageEl) {
            errorMessageEl.textContent = '';
            errorMessageEl.style.display = 'none';
        }
    }

    // -------------------------------------------------------------
    // REGISTRATION HANDLER (Precise Field Lookup)
    // -------------------------------------------------------------
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();

            // Grab inputs safely by ID, name, or fallback to querySelector
            const usernameInput = document.getElementById('regUsername') || registerForm.querySelector('input[name="username"]') || registerForm.querySelectorAll('input')[0];
            const fullNameInput = document.getElementById('regFullName') || registerForm.querySelector('input[name="fullName"]') || registerForm.querySelectorAll('input')[3] || registerForm.querySelectorAll('input')[1];
            const passwordInput = document.getElementById('regPassword') || registerForm.querySelector('input[type="password"]');

            const username = usernameInput ? usernameInput.value.trim() : '';
            const fullName = fullNameInput ? fullNameInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';

            if (!username || !fullName || !password) {
                showError('Please fill in all required fields.');
                return;
            }

            try {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, fullName, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    showError(data.error || data.message || 'Registration failed');
                    return;
                }

                // Success -> Redirect to dashboard
                window.location.href = '/dashboard.html';
            } catch (err) {
                console.error('Register error:', err);
                showError('Network error! Could not connect to server.');
            }
        });
    }

    // -------------------------------------------------------------
    // LOGIN HANDLER
    // -------------------------------------------------------------
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();

            const usernameInput = document.getElementById('loginUsername') || loginForm.querySelector('input[name="username"]') || loginForm.querySelectorAll('input')[0];
            const passwordInput = document.getElementById('loginPassword') || loginForm.querySelector('input[type="password"]');

            const username = usernameInput ? usernameInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';

            if (!username || !password) {
                showError('Please enter both username and password.');
                return;
            }

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    showError(data.error || data.message || 'Login failed');
                    return;
                }

                window.location.href = '/dashboard.html';
            } catch (err) {
                console.error('Login error:', err);
                showError('Network error! Could not connect to server.');
            }
        });
    }

    // -------------------------------------------------------------
    // FEED & MESSAGES
    // -------------------------------------------------------------
    fetch('/api/me')
        .then(res => {
            if (res.ok) loadMessages();
        })
        .catch(() => {});

    async function loadMessages() {
        const feedContainer = document.getElementById('messageFeed');
        if (!feedContainer) return;

        try {
            const res = await fetch('/api/messages');
            const messages = await res.json();

            feedContainer.innerHTML = '';
            messages.forEach(msg => {
                const card = document.createElement('div');
                card.className = 'message-card';
                card.innerHTML = `
                    <strong>${escapeHtml(msg.sender)}</strong> (@${escapeHtml(msg.username)})
                    <p>${escapeHtml(msg.text)}</p>
                `;
                feedContainer.appendChild(card);
            });
        } catch (err) {
            console.error('Failed to load feed');
        }
    }

    if (messageForm) {
        messageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const textInput = document.getElementById('messageText') || messageForm.querySelector('input');
            if (!textInput || !textInput.value.trim()) return;

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
                console.error('Error posting message');
            }
        });
    }

    function escapeHtml(text) {
        return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : '';
    }
});
