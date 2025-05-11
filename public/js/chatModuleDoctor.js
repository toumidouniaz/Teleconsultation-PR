export class ChatModuleDoctor {
    constructor(socket, currentUser) {
        this.socket = socket;
        this.currentUser = currentUser;
        this.currentChatContact = null;

        // Bind all methods that will be used as callbacks
        this.handleIncomingMessage = this.handleIncomingMessage.bind(this);
        this.handleTypingIndicator = this.handleTypingIndicator.bind(this);
        this.sendMessage = this.sendMessage.bind(this);
        this.handlePageTransition();

        this.initializeSocket();
        this.initializeEventListeners();
    }

    handlePageTransition() {
        // Save chat state before leaving page
        window.addEventListener('beforeunload', () => {
            if (this.currentChatContact) {
                localStorage.setItem('lastChatContact', JSON.stringify(this.currentChatContact));
            }
        });

        // Restore chat state when arriving on chat page
        if (window.location.pathname.includes('/chat')) {
            const lastContact = localStorage.getItem('lastChatContact');
            if (lastContact) {
                this.openChatWithContact(JSON.parse(lastContact));
            } else {
                this.loadChatContacts();
            }
        }
    }

    initializeSocket() {
        // Socket event listeners
        this.socket.on('private-message', this.handleIncomingMessage);
        this.socket.on('typing', this.handleTypingIndicator);
        this.socket.on('unread-messages', this.loadUnreadMessages);

        // Handle connection events
        this.socket.on('connect', () => {
            console.log('Chat connected');
        });

        this.socket.on('disconnect', () => {
            console.log('Chat disconnected');
        });

        this.socket.on('connect_error', (err) => {
            console.error('Chat connection error:', err);
            this.showToast('Chat connection lost', 'error');
        });

        //this.socket.on('message-sent', (message) => {
        // Optional: Confirm message delivery
        //});

        this.socket.on('message-error', (error) => {
            this.showToast(`Failed to send: ${error.message}`, 'error');
        });
    }

    initializeEventListeners() {
        // UI event listeners
        document.getElementById('sendMessageBtn')?.addEventListener('click', this.sendMessage.bind(this));

        const messageInput = document.getElementById('chatMessageInput');
        if (messageInput) {
            messageInput.addEventListener('input', (e) => {
                if (this.currentChatContact) {
                    this.socket.emit('typing', {
                        recipientId: this.currentChatContact.id,
                        recipientType: this.currentUser.userType === 'doctor' ? 'patient' : 'doctor',
                        isTyping: e.target.value.length > 0
                    });
                }
            });
        }

        document.getElementById('chatSearch')?.addEventListener('input', (e) => {
            this.searchChatContacts(e.target.value.trim());
        });
    }

    // Chat contact methods
    async searchChatContacts(query) {
        try {
            const token = localStorage.getItem('authToken');
            if (!token) {
                window.location.href = '/login';
                return;
            }

            if (query.length < 2) {
                await this.loadChatContacts();
                return;
            }

            const response = await fetch(`/api/chat/contacts/search?userId=${this.currentUser.userId}&userType=${this.currentUser.userType}&query=${encodeURIComponent(query)}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error('Search failed');
            const contacts = await response.json();
            this.renderChatContacts(contacts);
        } catch (error) {
            console.error('Search error:', error);
            this.showToast('Failed to search contacts', 'error');
        }
    }

    async loadChatContacts() {
        try {
            const token = localStorage.getItem('authToken');
            if (!token) {
                window.location.href = '/login';
                return;
            }

            const response = await fetch('/api/chat/contacts', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) throw new Error('Failed to load contacts');
            const contacts = await response.json();
            this.renderChatContacts(contacts);
        } catch (error) {
            console.error('Error loading chat contacts:', error);
            this.showToast('Failed to load chat contacts', 'error');
        }
    }

    renderChatContacts(contacts) {
        const container = document.getElementById('chatContacts');
        if (!container) return;

        container.innerHTML = '';

        if (contacts.length === 0) {
            container.innerHTML = '<div class="text-muted p-2">No contacts found</div>';
            return;
        }

        contacts.forEach(contact => {
            const contactEl = document.createElement('button');
            contactEl.className = `list-group-item list-group-item-action d-flex justify-content-between align-items-center ${contact.unreadCount > 0 ? 'unread-chat' : ''}`;
            contactEl.innerHTML = `
        <div>
          <strong>${contact.first_name} ${contact.last_name}</strong>
          <div class="small text-muted">${contact.speciality || contact.type}</div>
        ${contact.unreadCount > 0 ? `<span class="badge bg-primary rounded-pill">${contact.unreadCount}</span>` : ''}
      `;
            contactEl.addEventListener('click', () => this.openChatWithContact(contact));
            container.appendChild(contactEl);
        });
    }

    async openChatWithContact(contact) {
        this.currentChatContact = contact;
        document.getElementById('chatTitle').textContent = `Chat with ${contact.first_name} ${contact.last_name}`;

        // Enable message input for standalone page
        const messageInput = document.getElementById('chatMessageInput');
        const sendButton = document.getElementById('sendMessageBtn');
        if (messageInput) messageInput.disabled = false;
        if (sendButton) sendButton.disabled = false;

        try {
            const response = await fetch(`/api/chat/history?userId=${this.currentUser.id}&userType=${this.currentUser.userType}&contactId=${contact.id}&contactType=${this.currentUser.userType === 'doctor' ? 'patient' : 'doctor'}`);
            if (!response.ok) throw new Error('Failed to load chat history');

            const messages = await response.json();
            this.renderChatMessages(messages);
        } catch (error) {
            console.error('Error loading chat history:', error);
            this.showToast('Failed to load chat history', 'error');
        }
    }

    renderChatMessages(messages) {
        const chatContainer = document.getElementById('chatMessages');
        if (!chatContainer) return;

        chatContainer.innerHTML = '';

        messages.forEach(msg => {
            // Corrected comparison - check against current user's ID and type
            const isMe = msg.sender_id === this.currentUser.id && msg.sender_type === this.currentUser.userType;
            const messageEl = document.createElement('div');
            messageEl.className = `mb-2 ${isMe ? 'text-end' : 'text-start'}`;
            messageEl.innerHTML = `
                <div class="d-inline-block p-2 rounded ${isMe ? 'bg-success text-white' : 'bg-light'}">
                    ${msg.message}
                    <div class="small text-muted">${this.formatTime(msg.created_at)}</div>
                </div>
            `;
            chatContainer.appendChild(messageEl);
        });

        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    sendMessage() {
        const input = document.getElementById('chatMessageInput');
        const message = input?.value.trim();

        if (message && this.currentChatContact) {
            this.socket.emit('private-message', {
                recipientId: this.currentChatContact.id,
                recipientType: this.currentUser.userType === 'doctor' ? 'patient' : 'doctor',
                message: message,
                sender_name: `${this.currentUser.first_name} ${this.currentUser.last_name}`
            });

            // Add message to UI immediately
            const chatContainer = document.getElementById('chatMessages');
            if (chatContainer) {
                const messageEl = document.createElement('div');
                messageEl.className = 'mb-2 text-end';
                messageEl.innerHTML = `
          <div class="d-inline-block p-2 rounded bg-success text-white">
            ${message}
            <div class="small text-muted">Just now</div>
          </div>
        `;
                chatContainer.appendChild(messageEl);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            if (input) input.value = '';
        }
    }

    // Event handlers
    handleIncomingMessage(message) {
        // Improved current chat check
        const isCurrentChat = (
            (message.sender_id === this.currentChatContact?.id &&
                message.sender_type === this.currentChatContact?.type) ||
            (message.receiver_id === this.currentUser.id &&
                message.receiver_type === this.currentUser.userType)
        );

        if (isCurrentChat) {
            this.addMessageToUI(message);
        } else {
            this.showToast(`New message from ${message.sender_name}`, 'info');
            this.loadChatContacts(); // Refresh unread counts
        }
    }

    addMessageToUI(message) {
        const chatContainer = document.getElementById('chatMessages');
        if (!chatContainer) return;

        // Corrected comparison - check against current user's ID and type
        const isMe = message.sender_id === this.currentUser.id && message.sender_type === this.currentUser.userType;
        const messageEl = document.createElement('div');
        messageEl.className = `mb-2 ${isMe ? 'text-end' : 'text-start'}`;
        messageEl.innerHTML = `
            <div class="d-inline-block p-2 rounded ${isMe ? 'bg-success text-white' : 'bg-light'}">
                ${message.message}
                <div class="small text-muted">${this.formatTime(message.created_at)}</div>
            </div>
        `;
        chatContainer.appendChild(messageEl);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    handleTypingIndicator(data) {
        const indicator = document.getElementById('typingIndicator');
        if (indicator && data.senderId === this.currentChatContact?.id && data.senderType === 'patient') {
            indicator.style.display = data.isTyping ? 'block' : 'none';
        }
    }

    loadUnreadMessages(messages) {
        if (messages.length > 0) {
            this.showToast(`You have ${messages.length} unread messages`, 'info');
        }
    }

    // Helper methods
    formatTime(timeStr) {
        const date = new Date(timeStr);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    showToast(message, type = 'success') {
        // Implement or use existing toast notification
        console.log(`${type.toUpperCase()}: ${message}`);
        // Example: alert(`${type.toUpperCase()}: ${message}`);
    }

    // Cleanup method

    destroy() {
        this.socket.off('private-message');
        this.socket.off('typing');
        this.socket.off('unread-messages');

        // Remove UI event listeners
        const messageInput = document.getElementById('chatMessageInput');
        document.getElementById('sendMessageBtn')?.removeEventListener('click', this.sendMessage);
        messageInput?.removeEventListener('keypress', this.handleEnterKey);
        messageInput?.removeEventListener('input', this.handleTyping);
        document.getElementById('chatSearch')?.removeEventListener('input', this.handleSearch);
    }
}