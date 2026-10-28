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
    // REGISTRATION HANDLER
    // -------------------------------------------------------------
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();

            const inputs = registerForm.querySelectorAll('input');
            let username = '';
            let fullName = '';
            let password = '';

            inputs.forEach((input, index) => {
                if (input.type === 'password') {
                    password = input.value;
                } else if (index === 0) {
                    username = input.value;
                } else if (index === 3 || index === 2) {
                    fullName = input.value;
                }
            });

            if (!username && inputs[0]) username = inputs[0].value;
            if (!fullName && inputs[3]) fullName = inputs[3].value;
            if (!password && inputs[inputs.length - 1]) password = inputs[inputs.length - 1].value;

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

            const inputs = loginForm.querySelectorAll('input');
            let username = '';
            let password = '';

            inputs.forEach((input) => {
                if (input.type === 'password') {
                    password = input.value;
                } else {
                    username = input.value;
                }
            });

            if (!username && inputs[0]) username = inputs[0].value;
            if (!password && inputs[1]) password = inputs[1].value;

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
