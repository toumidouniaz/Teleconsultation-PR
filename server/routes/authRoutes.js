// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticateUser } = require('../middlewares/authMiddleware');
const authController = require('../controllers/authController');

// Registration routes
router.post('/register/doctor', authController.registerDoctor);
router.post('/register/patient', authController.registerPatient);

// Login route
router.post('/login', authController.login);
// In your authRoutes.js or similar
router.get('/verify', authenticateUser, (req, res) => {
    res.json({
        valid: true,
        user: {
            id: req.user.id,
            role: req.user.role,
            email: req.user.email
        }
    });
});

// Search doctors for patient registration
router.get('/doctors/search', async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.json({ doctors: [] });
        }

        const [doctors] = await pool.query(`
            SELECT d.user_id, CONCAT(u.first_name, ' ', u.last_name) AS name, d.speciality
            FROM doctors d
            JOIN users u ON d.user_id = u.id
            WHERE CONCAT(u.first_name, ' ', u.last_name) LIKE ? 
                OR d.speciality LIKE ?
            ORDER BY u.last_name
            LIMIT 10
        `, [`%${q}%`, `%${q}%`]);

        const formattedDoctors = doctors.map(doctor => ({
            user_id: doctor.user_id,
            name: doctor.name,
            speciality: doctor.speciality
        }));

        res.json({ doctors: formattedDoctors });
    } catch (error) {
        console.error('Doctor search error:', error);
        res.status(500).json({ error: 'Failed to search doctors' });
    }
});

router.post('/logout', authenticateUser, authController.logout);

module.exports = router;
