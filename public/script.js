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
            const username = inputs[0] ? inputs[0].value.trim() : '';
            const email = inputs[1] ? inputs[1].value.trim() : '';
            const phone = inputs[2] ? inputs[2].value.trim() : '';
            const fullName = inputs[3] ? inputs[3].value.trim() : '';
            const password = inputs[inputs.length - 1] ? inputs[inputs.length - 1].value : '';

            if (!username || !fullName || !password) {
                showError('Please fill in all required fields.');
                return;
            }

            try {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, phone, fullName, password })
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
            const username = inputs[0] ? inputs[0].value.trim() : '';
            const password = inputs[inputs.length - 1] ? inputs[inputs.length - 1].value : '';

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
    // PROFILE & CREW MEMBERS & MESSAGES INITIALIZATION
    // -------------------------------------------------------------
    fetch('/api/me')
        .then(async res => {
            if (res.ok) {
                const user = await res.json();
                updateProfileUI(user);
                loadMessages();
                loadCrewMembers();
            } else {
                // If on dashboard/profile page and not logged in, show fallback
                const profileName = document.querySelector('.profile-name, h3, #profileName');
                if (profileName) profileName.textContent = 'User not found';
            }
        })
        .catch(() => {});

    function updateProfileUI(user) {
        const nameEl = document.getElementById('profileName') || document.querySelector('.profile-name');
        const usernameEl = document.getElementById('profileUsername') || document.querySelector('.profile-username');
        if (nameEl) nameEl.textContent = user.fullName;
        if (usernameEl) usernameEl.textContent = `@${user.username}`;
    }

    async function loadCrewMembers() {
        const crewContainer = document.getElementById('crewMembersList') || document.querySelector('.minion-crew-container');
        if (!crewContainer) return;

        try {
            const res = await fetch('/api/users');
            const users = await res.json();

            crewContainer.innerHTML = '<h4>Minion Crew Members</h4>';
            users.forEach(u => {
                const item = document.createElement('div');
                item.className = 'crew-member-item';
                item.innerHTML = `<strong>${escapeHtml(u.fullName)}</strong> (@${escapeHtml(u.username)})`;
                crewContainer.appendChild(item);
            });
        } catch (err) {
            console.error('Failed to load crew members');
        }
    }

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
                } else {
                    const errData = await res.json();
                    alert(errData.error || 'Failed to post message');
                }
            } catch (err) {
                console.error('Error posting message');
                alert('Network error posting message.');
            }
        });
    }

    function escapeHtml(text) {
        return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : '';
    }
});
