const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticateUser } = require('../middlewares/authMiddleware');

// Get chat contacts
router.get('/contacts', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const userType = req.user.role.toLowerCase();

        console.log('Fetching contacts for:', userId, userType);

        let contacts = [];
        if (userType === 'doctor') {
            // Get all patients this doctor has chatted with
            const [rows] = await pool.query(`
                SELECT DISTINCT p.user_id as id, u.first_name, u.last_name, 
                    (SELECT COUNT(*) FROM chat_messages cm 
                    JOIN chats c ON cm.chat_id = c.id 
                    WHERE c.patient_id = p.user_id AND c.doctor_id = ? 
                    AND cm.receiver_id = ? AND cm.is_read = 0) as unread_count
                FROM patients p
                JOIN users u ON p.user_id = u.id
                JOIN chats c ON p.user_id = c.patient_id
                WHERE c.doctor_id = ?
            `, [userId, userId, userId]);

            contacts = rows;
        } else {
            // Get all doctors this patient has chatted with
            const [rows] = await pool.query(`
                SELECT DISTINCT d.user_id as id, u.first_name, u.last_name, d.speciality,
                    (SELECT COUNT(*) FROM chat_messages cm 
                    JOIN chats c ON cm.chat_id = c.id 
                    WHERE c.doctor_id = d.user_id AND c.patient_id = ? 
                    AND cm.receiver_id = ? AND cm.is_read = 0) as unread_count
                FROM doctors d
                JOIN users u ON d.user_id = u.id
                JOIN chats c ON d.user_id = c.doctor_id
                WHERE c.patient_id = ?
            `, [userId, userId, userId]);

            contacts = rows;
        }

        console.log('Found contacts:', contacts.length);
        res.json(contacts);
    } catch (err) {
        console.error('Error fetching chat contacts:', err);
        res.status(500).json({ error: 'Failed to fetch contacts: ' + err.message });
    }
});

// Get chat history
router.get('/history', authenticateUser, async (req, res) => {
    try {
        const { userId, userType, contactId, contactType } = req.query;

        if (!userId || !userType || !contactId || !contactType) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Find the chat between these users
        const [chats] = await pool.query(`
            SELECT * FROM chats 
            WHERE (patient_id = ? AND doctor_id = ?) OR (patient_id = ? AND doctor_id = ?)
        `, [
            userType === 'patient' ? userId : contactId,
            userType === 'doctor' ? userId : contactId,
            userType === 'doctor' ? contactId : userId,
            userType === 'patient' ? contactId : userId
        ]);

        if (chats.length === 0) {
            return res.json([]);
        }

        const chatId = chats[0].id;

        // Get messages for this chat
        const [messages] = await pool.query(`
            SELECT * FROM chat_messages
            WHERE chat_id = ?
            ORDER BY created_at ASC
        `, [chatId]);

        // Mark messages as read
        await pool.query(`
            UPDATE chat_messages
            SET is_read = 1
            WHERE chat_id = ? AND receiver_id = ? AND is_read = 0
        `, [chatId, userId]);

        res.json(messages);
    } catch (err) {
        console.error('Error fetching chat history:', err);
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
});

// Search contacts
router.get('/contacts/search', authenticateUser, async (req, res) => {
    try {
        const { userId, userType, query } = req.query;

        if (!userId || !userType || !query) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        let contacts;
        if (userType === 'doctor') {
            // Search patients
            [contacts] = await pool.query(`
                SELECT p.user_id as id, u.first_name, u.last_name
                FROM patients p
                JOIN users u ON p.user_id = u.id
                WHERE (u.first_name LIKE ? OR u.last_name LIKE ?)
            `, [`%${query}%`, `%${query}%`]);
        } else {
            // Search doctors
            [contacts] = await pool.query(`
                SELECT d.user_id as id, u.first_name, u.last_name, d.speciality
                FROM doctors d
                JOIN users u ON d.user_id = u.id
                WHERE (u.first_name LIKE ? OR u.last_name LIKE ? OR d.speciality LIKE ?)
            `, [`%${query}%`, `%${query}%`, `%${query}%`]);
        }

        res.json(contacts);
    } catch (err) {
        console.error('Error searching contacts:', err);
        res.status(500).json({ error: 'Failed to search contacts' });
    }
});

// Get unread message count
router.get('/unread-count', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;

        const [result] = await pool.query(`
            SELECT COUNT(*) as count 
            FROM chat_messages 
            WHERE receiver_id = ? AND is_read = 0
        `, [userId]);

        res.json({ count: result[0].count });
    } catch (err) {
        console.error('Error getting unread count:', err);
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

module.exports = router;
