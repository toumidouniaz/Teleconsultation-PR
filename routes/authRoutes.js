// routes/authRoutes.js
const express = require('express');
const router = express.Router();
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

module.exports = router;