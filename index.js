require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const pool = require('./db');
const fhirUtils = require('./fhirUtils');
const jwt = require('jsonwebtoken');

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use((req, res, next) => {
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    next();
});

// Route imports
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const doctorRoutes = require('./routes/doctorRoutes');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);

// FHIR API Endpoints
app.get('/fhir/Patient/:id', async (req, res) => {
    try {
        const [patients] = await pool.query(`
            SELECT * FROM patients WHERE fhir_id = ?
        `, [req.params.id]);

        if (patients.length === 0) {
            return res.status(404).json(
                fhirUtils.createOperationOutcome("error", "not-found", "Patient not found")
            );
        }

        const patientResource = fhirUtils.createPatientResource(patients[0]);
        res.type('application/fhir+json').json(patientResource);
    } catch (err) {
        console.error(err);
        res.status(500).json(
            fhirUtils.createOperationOutcome("error", "server-error", "Server error occurred")
        );
    }
});

app.post('/fhir/Appointment', async (req, res) => {
    try {
        const fhirAppointment = req.body;

        // Validate required fields
        if (!fhirAppointment.participant || fhirAppointment.participant.length < 2) {
            return res.status(400).json(
                fhirUtils.createOperationOutcome("error", "required", "Appointment must have at least 2 participants")
            );
        }

        // Convert and save to database
        const [result] = await pool.query(`
            INSERT INTO appointments 
            (patient_id, doctor_id, appointment_date, appointment_time, reason, status, fhir_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            getLocalId(fhirAppointment.participant[0].actor.reference),
            getLocalId(fhirAppointment.participant[1].actor.reference),
            fhirAppointment.start.split('T')[0],
            fhirAppointment.start.split('T')[1].substring(0, 5),
            fhirAppointment.serviceType?.[0]?.coding?.[0]?.display || 'Consultation',
            fhirAppointment.status === 'booked' ? 'confirmed' : 'pending',
            fhirAppointment.id || uuidv4()
        ]);

        // Return the created appointment
        const [appointment] = await pool.query(`
            SELECT a.*, 
                   p.fhir_id AS patient_fhir_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                   d.fhir_id AS doctor_fhir_id, CONCAT(d.first_name, ' ', d.last_name) AS doctor_name, d.speciality
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.id = ?
        `, [result.insertId]);

        const responseResource = fhirUtils.createAppointmentResource(appointment[0]);
        res.status(201).type('application/fhir+json').json(responseResource);
    } catch (err) {
        console.error(err);
        res.status(500).json(
            fhirUtils.createOperationOutcome("error", "server-error", "Server error occurred")
        );
    }
});

// Static File Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'auth', 'login.html'));
});

app.get('/register', (req, res) => {
    const type = req.query.type;
    const registerPage = type === 'doctor'
        ? 'register_doctor.html'
        : 'register_patient.html';
    res.sendFile(path.join(__dirname, 'public', 'html', 'auth', registerPage));
});

app.get('/patient/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'patient_dashboard.html'));
});

app.get('/doctor/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'doctor_dashboard.html'));
});
app.get('/doctor/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'chat.html'));
});

app.get('/patient/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'chat.html'));
});

app.get('/api/chat/history', async (req, res) => {
    try {
        const { userId, userType, contactId, contactType, limit = 50 } = req.query;

        // Validate input
        if (!userId || !userType || !contactId || !contactType) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const [messages] = await pool.query(`
            SELECT 
                cm.*,
                u.first_name as sender_first_name,
                u.last_name as sender_last_name,
                IFNULL(d.speciality, NULL) as sender_speciality
            FROM chat_messages cm
            JOIN users u ON cm.sender_id = u.id
            LEFT JOIN doctors d ON cm.sender_type = 'doctor' AND cm.sender_id = d.user_id
            WHERE (
                (cm.sender_id = ? AND cm.sender_type = ? AND cm.receiver_id = ? AND cm.receiver_type = ?)
                OR 
                (cm.receiver_id = ? AND cm.receiver_type = ? AND cm.sender_id = ? AND cm.sender_type = ?)
            )
            ORDER BY cm.created_at DESC
            LIMIT ?
        `, [
            userId, userType, contactId, contactType,
            userId, userType, contactId, contactType,
            parseInt(limit)
        ]);

        res.json(messages.reverse());
    } catch (err) {
        console.error('Chat history error:', err);
        res.status(500).json({ error: 'Failed to load chat history' });
    }
});

app.get('/api/chat/contacts', async (req, res) => {
    try {
        const { userId, userType } = req.query;

        if (!userId || !userType) {
            return res.status(400).json({ error: 'Missing user parameters' });
        }

        // First get all chat conversations from the chats table
        const [conversations] = await pool.query(`
            SELECT 
                c.id as chat_id,
                c.patient_id,
                c.doctor_id,
                c.last_message_at,
                IF(? = 'doctor', p.user_id, d.user_id) as contact_user_id,
                IF(? = 'doctor', 'patient', 'doctor') as contact_type
            FROM chats c
            JOIN patients p ON c.patient_id = p.user_id
            JOIN doctors d ON c.doctor_id = d.user_id
            WHERE (? = 'doctor' AND c.doctor_id = ?)
               OR (? = 'patient' AND c.patient_id = ?)
            ORDER BY c.last_message_at DESC
        `, [userType, userType, userType, userId, userType, userId]);

        // Then enrich with user details and unread counts
        const contacts = await Promise.all(conversations.map(async conv => {
            const [user] = await pool.query(`
                SELECT 
                    u.id, 
                    u.first_name, 
                    u.last_name,
                    ${conv.contact_type === 'doctor' ? 'd.speciality' : 'NULL as speciality'}
                FROM users u
                ${conv.contact_type === 'doctor' ? 'LEFT JOIN doctors d ON u.id = d.user_id' : ''}
                WHERE u.id = ?
            `, [conv.contact_user_id]);

            const [unread] = await pool.query(`
                SELECT COUNT(*) as count
                FROM chat_messages
                WHERE sender_id = ? 
                  AND sender_type = ?
                  AND receiver_id = ?
                  AND receiver_type = ?
                  AND is_read = FALSE
            `, [
                conv.contact_user_id,
                conv.contact_type,
                userId,
                userType
            ]);

            return {
                ...user[0],
                chat_id: conv.chat_id,
                unreadCount: unread[0].count,
                last_message_at: conv.last_message_at,
                type: conv.contact_type
            };
        }));

        res.json(contacts);
    } catch (err) {
        console.error('Chat contacts error:', err);
        res.status(500).json({ error: 'Failed to load contacts' });
    }
});

app.get('/api/chat/contacts/search', async (req, res) => {
    try {
        const { userId, userType, query } = req.query;

        // Validate inputs
        if (!userId || !userType || !query) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        if (query.length < 2) {
            return res.status(400).json({ error: 'Search query too short (min 2 characters)' });
        }

        const isDoctor = userType.toLowerCase() === 'doctor';
        const contactType = isDoctor ? 'patient' : 'doctor';
        const searchParam = `%${query}%`;

        // Main query
        const
            sqlQuery = `
        SELECT 
            u.id,
            u.first_name,
            u.last_name,
            ${isDoctor ? 'NULL as speciality' : 'd.speciality'},
            u.role as type,
            (
                SELECT COUNT(*) 
                FROM chat_messages 
                WHERE sender_id = u.id 
                  AND sender_type = ?
                  AND receiver_id = ?
                  AND receiver_type = ?
                  AND is_read = FALSE
            ) as unread_count,
            (
                SELECT id 
                FROM chats 
                WHERE ${isDoctor ? 'doctor_id = ? AND patient_id = u.id' : 'patient_id = ? AND doctor_id = u.id'}
                LIMIT 1
            ) as chat_id
        FROM users u
        ${isDoctor ? 'JOIN patients p ON u.id = p.user_id' : 'JOIN doctors d ON u.id = d.user_id'}
        WHERE u.role = ?
          AND u.id != ?
          AND (u.first_name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?)
        ORDER BY u.first_name, u.last_name
    `;

        const params = [
            contactType, userId, userType,  // For unread_count subquery
            userId,                        // For chat_id subquery
            contactType,                   // For role filter
            userId,                        // For u.id != ?
            searchParam, searchParam, searchParam  // For search terms
        ];

        const [contacts] = await pool.query(sqlQuery, params);

        // Format results to match frontend expectations
        const formattedContacts = contacts.map(contact => ({
            id: contact.id,
            first_name: contact.first_name,
            last_name: contact.last_name,
            speciality: contact.speciality || null,
            type: contact.type,
            unreadCount: contact.unread_count || 0,
            chat_id: contact.chat_id || null
        }));

        res.json(formattedContacts);

    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({
            error: 'Failed to search contacts',
            details: err.message
        });
    }
});

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token provided'));

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Validate required fields
        if (!decoded.userId || !decoded.role) {
            throw new Error('Invalid token payload');
        }

        const userType = decoded.role.toLowerCase();
        if (!['doctor', 'patient'].includes(userType)) {
            throw new Error('Invalid user type');
        }

        // Attach user info to socket
        socket.user = {
            id: decoded.userId,
            type: userType
        };

        next();
    } catch (err) {
        next(new Error('Authentication failed'));
    }
});

io.on('connection', (socket) => {
    console.log(`Authenticated ${socket.user.type} connected:`, socket.user.id);

    // Join user-specific room
    socket.join(`user_${socket.user.type}_${socket.user.id}`);

    // Message handling
    socket.on('private-message', async (data) => {
        try {
            // Validate input
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid message format');
            }

            const { recipientId, recipientType, message } = data;

            if (!recipientId || !recipientType || !message) {
                throw new Error('Missing required fields');
            }

            if (typeof message !== 'string' || message.length > 1000) {
                throw new Error('Invalid message content');
            }

            // Ensure chat exists
            const chatId = await ensureChatExists(
                socket.user.id,
                socket.user.type,
                recipientId,
                recipientType
            );

            // Save message
            const [result] = await pool.query(
                `INSERT INTO chat_messages 
                 (sender_id, sender_type, receiver_id, receiver_type, message)
                 VALUES (?, ?, ?, ?, ?)`,
                [socket.user.id, socket.user.type, recipientId, recipientType, message]
            );

            // Update chat timestamp
            await pool.query(
                `UPDATE chats 
                 SET last_message_at = NOW()
                 WHERE id = ?`,
                [chatId]
            );

            // Get sender info
            const [user] = await pool.query(
                `SELECT first_name, last_name FROM users WHERE id = ?`,
                [socket.user.id]
            );

            if (!user) throw new Error('Sender not found');

            // Prepare message payload
            const messagePayload = {
                id: result.insertId,
                chat_id: chatId,
                sender_id: socket.user.id,
                sender_type: socket.user.type,
                sender_name: `${user.first_name} ${user.last_name}`,
                message,
                timestamp: new Date()
            };

            // Deliver message
            io.to(`user_${recipientType}_${recipientId}`)
                .emit('private-message', messagePayload);

            // Confirm to sender
            socket.emit('message-sent', messagePayload);

        } catch (err) {
            console.error('Message error:', err.message);
            socket.emit('message-error', {
                error: err.message,
                code: 'MESSAGE_FAILED'
            });
        }
    });

    // Typing indicator
    socket.on('typing', ({ recipientId, recipientType, isTyping }) => {
        // Basic validation
        if (typeof isTyping !== 'boolean' || !recipientId || !recipientType) return;

        io.to(`user_${recipientType}_${recipientId}`).emit('typing', {
            senderId: socket.user.id,
            senderType: socket.user.type,
            isTyping
        });
    });

    // Disconnect handler
    socket.on('disconnect', () => {
        console.log(`${socket.user.type} disconnected:`, socket.user.id);
    });
});

// Helper function to ensure chat exists
async function ensureChatExists(userId, userType, contactId, contactType) {
    try {
        // Try to find existing chat
        const [existingChat] = await pool.query(`
                SELECT id FROM chats 
                WHERE ((doctor_id = ? AND patient_id = ?) OR (doctor_id = ? AND patient_id = ?))
                LIMIT 1
            `, [
            userType === 'doctor' ? userId : contactId,
            userType === 'patient' ? userId : contactId,
            contactType === 'doctor' ? contactId : userId,
            contactType === 'patient' ? contactId : userId
        ]);

        if (existingChat.length > 0) {
            return existingChat[0].id;
        }

        // Create new chat if none exists
        const newChatId = uuidv4();
        await pool.query(`
                INSERT INTO chats (id, doctor_id, patient_id)
                VALUES (?, ?, ?)
            `, [
            newChatId,
            userType === 'doctor' ? userId : contactId,
            userType === 'patient' ? userId : contactId
        ]);

        return newChatId;
    } catch (err) {
        console.error('Error ensuring chat exists:', err);
        throw err;
    }
}

// Helper Functions
function getLocalId(fhirReference) {
    return fhirReference.split('/')[1];
}

// Database Connection Test
async function testDatabaseConnection() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query('SELECT version() AS version');
        console.log('Database connected. MariaDB version:', rows[0].version);
    } catch (err) {
        console.error('Database connection failed:', err.message);
        process.exit(1);
    } finally {
        if (connection) connection.release();
    }
}

// Start Server
const PORT = process.env.PORT || 3000;
http.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    await testDatabaseConnection();
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json(
        fhirUtils.createOperationOutcome("error", "server-error", "Something went wrong!")
    );
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});