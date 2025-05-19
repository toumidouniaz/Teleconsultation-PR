const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../../db');

module.exports = function initializeSocket(server) {
    const io = new Server(server, {
        cors: {
            origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
            methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
            allowedHeaders: ['Authorization'],
            credentials: true,
        },
        allowEIO3: true,
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: 1e8,
        transports: ['websocket', 'polling']
    });

    io.use((socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        if (!token) return next(new Error('No token provided'));

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (!decoded.userId || !decoded.role) throw new Error('Invalid token payload');

            const userType = decoded.role.toLowerCase();
            if (!['doctor', 'patient'].includes(userType)) throw new Error('Invalid user type');

            socket.user = {
                id: decoded.userId,
                type: userType
            };
            next();
        } catch (err) {
            next(new Error('Authentication failed'));
        }
    });

    // Store active consultations
    const activeConsultations = new Map();

    io.on('connection', (socket) => {
        console.log('New socket connection:', socket.id);

        socket.join(`user-${socket.user.id}`);


        // Join appointment room
        socket.on('joinAppointment', async (data) => {
            const { appointmentId, userId, userRole } = data;

            // Join the room
            socket.join(`appointment-${appointmentId}`);

            console.log(`${userRole} ${userId} joined appointment ${appointmentId}`);

            // Store user in active consultations
            if (!activeConsultations.has(appointmentId)) {
                activeConsultations.set(appointmentId, new Map());
            }

            activeConsultations.get(appointmentId).set(userId, {
                socketId: socket.id,
                userRole
            });

            // Notify the other participant
            socket.to(`appointment-${appointmentId}`).emit('userJoined', {
                userId,
                userRole
            });
        });

        // Handle chat messages
        socket.on('chatMessage', async (data) => {
            console.log('Chat message received:', data);
            const { appointmentId, senderId, senderType, message, receiverId, receiverType } = data;

            try {
                let chatId;

                // If this is an appointment chat
                if (data.appointmentId) {
                    const [appointments] = await pool.query(`
                SELECT * FROM appointments WHERE id = ?
            `, [data.appointmentId]);

                    if (appointments.length === 0) {
                        socket.emit('error', { message: 'Appointment not found' });
                        return;
                    }

                    const [chats] = await pool.query(`
                SELECT * FROM chats 
                WHERE appointment_id = ?
            `, [data.appointmentId]);

                    if (chats.length === 0) {
                        chatId = require('uuid').v4();
                        await pool.query(`
                    INSERT INTO chats (id, patient_id, doctor_id, appointment_id, last_message_at)
                    VALUES (?, ?, ?, ?, NOW())
                `, [
                            chatId,
                            appointments[0].patient_id,
                            appointments[0].doctor_id,
                            data.appointmentId
                        ]);
                    } else {
                        chatId = chats[0].id;
                        await pool.query(`
                    UPDATE chats SET last_message_at = NOW()
                    WHERE id = ?
                `, [chatId]);
                    }
                }
                // If this is a direct chat (no appointment)
                else {
                    const [chats] = await pool.query(`
                        SELECT * FROM chats 
                        WHERE (patient_id = ? AND doctor_id = ?) OR (patient_id = ? AND doctor_id = ?)
                        AND appointment_id IS NULL
                    `, [
                        data.senderType === 'patient' ? data.senderId : data.receiverId,
                        data.senderType === 'doctor' ? data.senderId : data.receiverId,
                        data.receiverId, data.senderId
                    ]);

                    if (chats.length === 0) {
                        chatId = require('uuid').v4();

                        // Determine patient_id and doctor_id based on sender and receiver types
                        const patientId = data.senderType === 'patient' ? data.senderId : data.receiverId;
                        const doctorId = data.senderType === 'doctor' ? data.senderId : data.receiverId;

                        await pool.query(`
                            INSERT INTO chats (id, patient_id, doctor_id, last_message_at)
                            VALUES (?, ?, ?, NOW())
                        `, [
                            chatId,
                            patientId,
                            doctorId
                        ]);
                    } else {
                        chatId = chats[0].id;
                        await pool.query(`
                            UPDATE chats SET last_message_at = NOW()
                            WHERE id = ?
                        `, [chatId]);
                    }
                }

                // Store message in database
                const [result] = await pool.query(`
            INSERT INTO chat_messages 
            (chat_id, sender_id, sender_type, receiver_id, receiver_type, message, is_read)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        `, [
                    chatId,
                    data.senderId,
                    data.senderType,
                    data.receiverId,
                    data.receiverType,
                    data.message
                ]);

                // Get the inserted message
                const [[newMessage]] = await pool.query(`
            SELECT * FROM chat_messages WHERE id = ?
        `, [result.insertId]);

                // Broadcast to the appropriate room
                if (data.appointmentId) {
                    // Use socket.to instead of io.to to exclude the sender
                    socket.to(`appointment-${data.appointmentId}`).emit('chatMessage', newMessage);
                } else {
                    // For direct messages, emit only to the receiver
                    const patientId = senderType === 'patient' ? senderId : receiverId;
                    const doctorId = senderType === 'doctor' ? senderId : receiverId;

                    const [chats] = await pool.query(`
                        SELECT * FROM chats 
                        WHERE (patient_id = ? AND doctor_id = ?)
                        AND appointment_id IS NULL
                    `, [patientId, doctorId]);

                    if (chats.length === 0) {
                        chatId = require('uuid').v4();
                        await pool.query(`
                            INSERT INTO chats (id, patient_id, doctor_id, last_message_at)
                            VALUES (?, ?, ?, NOW())
                        `, [
                            chatId,
                            patientId,
                            doctorId
                        ]);
                    } else {
                        chatId = chats[0].id;
                        await pool.query(`
                            UPDATE chats SET last_message_at = NOW()
                            WHERE id = ?
                        `, [chatId]);
                    }
                }

            } catch (err) {
                console.error('Error saving chat message:', err);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Handle health data requests
        socket.on('healthDataRequest', (data) => {
            socket.to(`appointment_${data.appointmentId}`).emit('healthDataRequest');
        });

        // Broadcast health data to all in the appointment room
        socket.on('healthData', (data) => {
            socket.to(`appointment_${data.appointmentId}`).emit('healthData', data.healthData);
        });

        // Handle call end
        socket.on('endCall', async (data) => {
            const { appointmentId, userId, userRole } = data;

            // Notify the other participant
            socket.to(`appointment-${appointmentId}`).emit('callEnded');

            // Update appointment status to 'completed' if doctor ends the call
            if (userRole === 'doctor') {
                try {
                    await pool.query(
                        'UPDATE appointments SET status = "completed" WHERE id = ?',
                        [appointmentId]
                    );
                } catch (err) {
                    console.error('Error updating appointment status:', err);
                }
            }

            // Remove user from active consultations
            const consultation = activeConsultations.get(appointmentId);
            if (consultation) {
                consultation.delete(userId);

                // Remove consultation if empty
                if (consultation.size === 0) {
                    activeConsultations.delete(appointmentId);
                }
            }
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log('Socket disconnected:', socket.id);

            // Find and remove user from active consultations
            for (const [appointmentId, users] of activeConsultations.entries()) {
                for (const [userId, user] of users.entries()) {
                    if (user.socketId === socket.id) {
                        users.delete(userId);

                        // Notify others in the room
                        socket.to(`appointment-${appointmentId}`).emit('userLeft', {
                            userId,
                            userRole: user.userRole
                        });

                        // Remove consultation if empty
                        if (users.size === 0) {
                            activeConsultations.delete(appointmentId);
                        }

                        break;
                    }
                }
            }
        });
    });

    return io;
};
