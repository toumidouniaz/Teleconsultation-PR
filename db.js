// db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'tele_user',
    password: 'tele_user1',
    database: 'teleconsultation',
    port: 3307,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'local',
    decimalNumbers: true
});

// Test connection
pool.getConnection()
    .then(conn => {
        console.log('Successfully connected to the database');
        conn.release();
    })
    .catch(err => {
        console.error('Database connection failed:', err);
    });

pool.query('SELECT 1 + 1 AS result')
    .then(console.log)
    .catch(console.error)

module.exports = pool;