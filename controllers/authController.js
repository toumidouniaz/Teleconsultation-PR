const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


// Register a new doctor
exports.registerDoctor = async (req, res) => {
    try {
        const { firstName, lastName, email, password, confirmPassword, speciality, phone, address } = req.body;

        // Validation
        if (!firstName || !lastName || !email || !password || !confirmPassword || !speciality) {
            return res.status(400).json({ error: "All fields are required" });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ error: "Passwords don't match" });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        // Check if user exists
        const [existingUser] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ error: "Email already in use" });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const conn = await pool.getConnection();
        await conn.beginTransaction();

        try {
            // Insert user
            const [userResult] = await conn.query(
                `INSERT INTO users (first_name, last_name, email, password, role, phone, address) 
                 VALUES (?, ?, ?, ?, 'doctor', ?, ?)`,
                [firstName, lastName, email, hashedPassword, phone, address]
            );

            // Insert doctor
            await conn.query(
                `INSERT INTO doctors (user_id, speciality) 
                 VALUES (?, ?)`,
                [userResult.insertId, speciality]
            );

            await conn.commit();
            res.status(201).json({ message: "Doctor registered successfully" });
        } catch (err) {
            await conn.rollback();
            console.error("Database error:", err);
            res.status(500).json({ error: "Database operation failed" });
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Registration failed" });
    }
};

// Register a new patient
exports.registerPatient = async (req, res) => {
    try {
        const { firstName, lastName, email, password, confirmPassword, age, phone, address } = req.body;

        // Validation
        if (!firstName || !lastName || !email || !password || !confirmPassword || !age) {
            return res.status(400).json({ error: "All fields are required" });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ error: "Passwords don't match" });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        // Check if user exists
        const [existingUser] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ error: "Email already in use" });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const conn = await pool.getConnection();
        await conn.beginTransaction();

        try {
            // Insert user
            const [userResult] = await conn.query(
                `INSERT INTO users (first_name, last_name, email, password, role, phone, address) 
                 VALUES (?, ?, ?, ?, 'patient', ?, ?)`,
                [firstName, lastName, email, hashedPassword, phone, address]
            );

            // Insert patient
            await conn.query(
                `INSERT INTO patients (user_id, age) 
                 VALUES (?, ?)`,
                [userResult.insertId, age]
            );

            await conn.commit();
            res.status(201).json({ message: "Patient registered successfully" });
        } catch (err) {
            await conn.rollback();
            console.error("Database error:", err);
            res.status(500).json({ error: "Database operation failed" });
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Registration failed" });
    }
};

// User login
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('Login attempt for:', req.body.email);

        // Validate input
        if (!email?.trim() || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        // Find user with password
        const [users] = await pool.query(
            'SELECT id, first_name, last_name, email, password, role FROM users WHERE email = ?',
            [email.trim().toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const user = users[0];

        // Verify password exists
        if (!user.password) {
            console.error("No password hash found for user:", user.email);
            return res.status(500).json({ error: "Authentication system error" });
        }

        // Compare passwords
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = jwt.sign(
            {
                userId: user.id,
                role: user.role,
                email: user.email
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Prepare response
        const responseData = {
            token,
            user: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                role: user.role
            },
            redirect: user.role === 'doctor' ? '/doctor/dashboard' : '/patient/dashboard'
        };

        res.json(responseData);

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            error: "Login failed",
            ...(process.env.NODE_ENV === 'development' && { details: error.message })
        });
    }
};

// Get current user (for frontend to check auth status)
exports.getCurrentUser = async (req, res) => {
    try {
        const [user] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (user.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const userData = {
            id: user[0].id,
            firstName: user[0].first_name,
            lastName: user[0].last_name,
            email: user[0].email,
            role: user[0].role
        };

        res.json(userData);
    } catch (error) {
        console.error("Get user error:", error);
        res.status(500).json({ error: "Failed to get user data" });
    }
};

exports.logout = async (req, res) => {
    try {
        // Clear the session
        req.session.destroy(err => {
            if (err) {
                console.error('Logout error:', err);
                return res.status(500).json({ error: 'Failed to logout' });
            }

            // Clear the cookie
            res.clearCookie('connect.sid', {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
            });

            return res.status(200).json({ message: 'Logged out successfully' });
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Server error during logout' });
    }
};