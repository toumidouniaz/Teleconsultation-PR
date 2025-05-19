require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const initializeSocket = require('./server/sockets/chatSocket');
const errorHandler = require('./server/middlewares/errorHandler');
const corsConfig = require('./server/middlewares/corsConfig');

// Add PeerJS server
const { ExpressPeerServer } = require('peer');

// Create PeerJS server
const peerServer = ExpressPeerServer(http, {
    debug: true,
    path: '/peerjs'
});

// Initialize socket.io with the server
initializeSocket(http);

// Use PeerJS server
app.use('/peerjs', peerServer);



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
app.use(corsConfig);

// Serve static files from node_modules for specific packages
app.use('/node_modules/jquery', express.static(path.join(__dirname, 'node_modules/jquery/dist')));
app.use('/node_modules/select2', express.static(path.join(__dirname, 'node_modules/select2/dist')));

// Routes
const fhirRoutes = require('./server/routes/fhirRoutes');
const staticRoutes = require('./server/routes/staticRoutes');
const chatRoutes = require('./server/routes/chatRoutes');
const authRoutes = require('./server/routes/authRoutes');
const patientRoutes = require('./server/routes/patientRoutes');
const doctorRoutes = require('./server/routes/doctorRoutes');

app.use('/fhir', fhirRoutes);
app.use('/', staticRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);

// Error handler (must come last)
app.use(errorHandler);

// DB connection test
const pool = require('./db');
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

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    await testDatabaseConnection();
});

// Catch unhandled promises
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});
