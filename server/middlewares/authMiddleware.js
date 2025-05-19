const jwt = require('jsonwebtoken');
const pool = require('../../db');

const authenticateUser = async (req, res, next) => {
    try {
        console.log('\n=== NEW REQUEST ===');
        console.log('Request URL:', req.originalUrl);
        console.log('Headers:', req.headers);
        console.log('Cookies:', req.cookies);

        const token = req.headers.authorization?.split(' ')[1] ||
            req.cookies?.token ||
            req.query?.token;

        console.log('Extracted token:', token);

        if (!token) {
            console.log('No token found');
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256'],
            ignoreExpiration: false
        });

        console.log('Decoded token:', decoded);

        // Verify user exists in database
        const [users] = await pool.query(
            'SELECT id, role, is_active FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (users.length === 0) {
            console.log('User not found in database');
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = {
            id: decoded.userId,
            role: decoded.role,
            email: decoded.email
        };

        console.log('Authentication successful for user:', req.user);
        next();
    } catch (err) {
        console.error('Authentication error:', err);

        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }

        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }

        res.status(500).json({ error: 'Authentication failed' });
    }
};

// Enhanced authorizeDoctor middleware
const authorizeDoctor = async (req, res, next) => {
    try {
        console.log('\nAuthorizing doctor for user:', req.user.id);

        // First verify the user exists and is a doctor
        const [users] = await pool.query(
            'SELECT id, role FROM users WHERE id = ? AND role = "doctor"',
            [req.user.id]
        );

        if (users.length === 0) {
            console.log('User is not a doctor or doesn\'t exist');
            return res.status(403).json({ error: 'Doctor access required' });
        }

        // Get the doctor record - using user_id as the identifier
        const [doctors] = await pool.query(
            `SELECT user_id, speciality 
       FROM doctors 
       WHERE user_id = ?`,
            [req.user.id]
        );

        console.log('Doctor record found:', doctors[0]);

        if (doctors.length === 0) {
            console.log('No doctor profile found for user:', req.user.id);
            return res.status(403).json({ error: 'Doctor profile not found' });
        }

        // Since your doctors table uses user_id as primary key
        req.user.doctorId = doctors[0].user_id; // Use user_id instead of id
        req.user.speciality = doctors[0].speciality;

        console.log('Doctor authorized. Doctor user_id:', req.user.doctorId);
        next();
    } catch (err) {
        console.error('Doctor authorization error:', err);
        res.status(500).json({ error: 'Authorization check failed' });
    }
};

// Similarly enhanced authorizePatient middleware
const authorizePatient = async (req, res, next) => {
    try {
        if (req.user.role !== 'patient') {
            return res.status(403).json({
                success: false,
                error: 'Patient access required',
                code: 'PATIENT_ACCESS_REQUIRED'
            });
        }

        const [patients] = await pool.query(
            `SELECT p.user_id, p.blood_type, p.allergies 
             FROM patients p 
             WHERE p.user_id = ?`,
            [req.user.id]
        );

        if (patients.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Patient profile not found',
                code: 'PATIENT_NOT_FOUND'
            });
        }

        req.user.patientId = patients[0].user_id;
        req.user.medicalInfo = {
            bloodType: patients[0].blood_type,
            allergies: patients[0].allergies
        };

        next();
    } catch (err) {
        console.error("Patient authorization error:", err);
        res.status(500).json({
            success: false,
            error: 'Authorization check failed',
            code: 'AUTHORIZATION_FAILED'
        });
    }
};

module.exports = {
    authenticateUser,
    authorizePatient,
    authorizeDoctor
};