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
    const allowedOrigins = ['http://localhost:3000'];
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

// WebSocket Setup
io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    socket.on('join-consultation', (consultationId) => {
        socket.join(consultationId);
        console.log(`User ${socket.id} joined consultation ${consultationId}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

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