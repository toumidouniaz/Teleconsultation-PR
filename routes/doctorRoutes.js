const express = require('express');
const router = express.Router();
const pool = require('../db');
const fhirUtils = require('../fhirUtils');
const { v4: uuidv4 } = require('uuid');
const { authenticateUser, authorizeDoctor } = require('../middlewares/authMiddleware');

// Get doctor dashboard data as FHIR Bundle
router.get('/dashboard', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        console.log('Dashboard request from user:', req.user.id);
        // Today's appointments
        const [todayAppointments] = await pool.query(`
            SELECT a.id, a.appointment_time, a.reason, a.status,
                   CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                   p.age AS patient_age
            FROM appointments a
            JOIN patients p ON a.patient_id = p.user_id
            JOIN users u ON p.user_id = u.id
            WHERE a.doctor_id = ? AND a.appointment_date = CURDATE()
            ORDER BY a.appointment_time
        `, [req.user.doctorId]);

        // Upcoming appointments
        const [upcomingAppointments] = await pool.query(`
            SELECT a.id, a.appointment_date, a.appointment_time, a.reason,
                   CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                   p.age AS patient_age
            FROM appointments a
            JOIN patients p ON a.patient_id = p.user_id
            JOIN users u ON p.user_id = u.id
            WHERE a.doctor_id = ? AND a.appointment_date > CURDATE()
            ORDER BY a.appointment_date, a.appointment_time
            LIMIT 10
        `, [req.user.doctorId]);

        const [pendingRequests] = await pool.query(`
            SELECT a.id, a.appointment_date, a.appointment_time, a.reason, a.fhir_id,
                   CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                   p.age AS patient_age
            FROM appointments a
            JOIN patients p ON a.patient_id = p.user_id
            JOIN users u ON p.user_id = u.id
            WHERE a.doctor_id = ? AND a.status = 'pending'
            ORDER BY a.appointment_date, a.appointment_time
        `, [req.user.doctorId]);

        // Recent patients
        const [recentPatients] = await pool.query(`
            SELECT DISTINCT p.user_id, p.fhir_id, 
                CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                p.age AS patient_age,
                MAX(a.appointment_date) AS last_visit
                FROM appointments a
                JOIN patients p ON a.patient_id = p.user_id
                JOIN users u ON p.user_id = u.id
                WHERE a.doctor_id = ?
                GROUP BY p.user_id, p.fhir_id, u.first_name, u.last_name, p.age
                ORDER BY last_visit DESC
                LIMIT 5;
        `, [req.user.doctorId]);

        // Structure the response data
        const dashboardData = {
            todayAppointments: todayAppointments.map(appt => ({
                id: appt.id,
                time: appt.appointment_time,
                patient: appt.patient_name,
                reason: appt.reason,
                status: appt.status
            })),
            upcomingAppointments: upcomingAppointments.map(appt => ({
                id: appt.id,
                date: appt.appointment_date,
                time: appt.appointment_time,
                patient: appt.patient_name,
                age: appt.patient_age,
                reason: appt.reason
            })),
            pendingRequests: pendingRequests.map(req => ({
                id: req.id,
                fhir_id: req.fhir_id,
                date: req.appointment_date,
                time: req.appointment_time,
                patient: req.patient_name,
                age: req.patient_age,
                reason: req.reason
            })),
            recentPatients: recentPatients.map(patient => ({
                id: patient.fhir_id,
                db_id: patient.user_id,
                name: patient.patient_name,
                age: patient.patient_age,
            }))

        };


        res.json(dashboardData);
        console.log('Sending dashboard data for doctor:', req.user.id);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create prescription (as FHIR MedicationRequest)
router.post('/prescriptions', authenticateUser, authorizeDoctor, async (req, res) => {
    const { patient_id, medication, dosage, frequency, duration, instructions, is_active, appointment_id } = req.body;

    try {
        // Validate required fields
        if (!patient_id || !medication || !dosage || !frequency || !duration) {
            return res.status(400).json(fhirUtils.createOperationOutcome("error", "required", "Missing required fields"));
        }

        // Create in database
        const [result] = await pool.query(`
            INSERT INTO prescriptions 
            (patient_id, doctor_id, appointment_id, prescription_date, 
             medication, dosage, frequency, duration, instructions, is_active, fhir_id)
            VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)
        `, [
            patient_id,
            req.user.doctorId,
            appointment_id || null,
            medication,
            dosage,
            frequency,
            duration,
            instructions || null,
            is_active !== false, // Default to true if not specified
            uuidv4()
        ]);

        // Get the created prescription with patient and doctor details
        const [[prescription]] = await pool.query(`
            SELECT p.*, 
                   pt.fhir_id AS patient_fhir_id,
                   d.fhir_id AS doctor_fhir_id
            FROM prescriptions p
            JOIN patients pt ON p.patient_id = pt.user_id
            JOIN doctors d ON p.doctor_id = d.user_id
            WHERE p.id = ?
        `, [result.insertId]);

        // Return as FHIR MedicationRequest
        const medicationRequest = fhirUtils.createMedicationRequestResource(prescription);
        res.status(201).type('application/fhir+json').json(medicationRequest);
    } catch (err) {
        console.error(err);
        res.status(500).json(fhirUtils.createOperationOutcome("error", "server-error", "Server error"));
    }
});

router.put('/appointments/:id/status', authenticateUser, authorizeDoctor, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        // Validate status
        if (!['confirmed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        // Update appointment status
        const [result] = await pool.query(
            `UPDATE appointments 
             SET status = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ? AND doctor_id = ?`,
            [status, id, req.user.doctorId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        res.json({ message: `Appointment ${status} successfully` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// In your routes
router.get('/chat/history', authenticateUser, async (req, res) => {
    try {
        const { consultationId } = req.query;
        const [messages] = await pool.query(`
            SELECT cm.*, u.first_name, u.last_name 
            FROM chat_messages cm
            JOIN users u ON cm.sender_id = u.id
            WHERE cm.consultation_id = ?
            ORDER BY cm.sent_at ASC
        `, [consultationId]);

        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load messages' });
    }
});

// Add to fhirUtils.js:
fhirUtils.generateFhirId = () => uuidv4();

module.exports = router;