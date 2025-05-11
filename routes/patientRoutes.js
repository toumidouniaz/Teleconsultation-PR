const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateUser, authorizePatient } = require('../middlewares/authMiddleware');
const { v4: uuidv4 } = require('uuid');

router.get('/dashboard', authenticateUser, authorizePatient, async (req, res) => {
    try {
        console.log('Dashboard request from user:', req.user.id);
        const [appointments] = await pool.query(`
            SELECT 
                a.id,
                a.appointment_date,
                a.appointment_time,
                a.reason,
                a.status,
                CONCAT(u.first_name, ' ', u.last_name) AS doctor_name,
                d.speciality
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.user_id
            JOIN users u ON d.user_id = u.id
            WHERE a.patient_id = ? 
            AND a.appointment_date >= CURDATE()
            ORDER BY a.appointment_date, a.appointment_time
        `, [req.user.patientId]);

        // Get prescriptions
        const [prescriptions] = await pool.query(`
            SELECT
                p.id,
                p.prescription_date,
                p.medication,
                p.dosage,
                p.instructions,
                CONCAT(u.first_name, ' ', u.last_name) AS doctor_name
            FROM prescriptions p
            JOIN doctors d ON p.doctor_id = d.user_id
            JOIN users u ON d.user_id = u.id
            WHERE p.patient_id = ?
            ORDER BY p.prescription_date DESC
            LIMIT 5
        `, [req.user.patientId]);

        const [availableDoctors] = await pool.query(`
            SELECT DISTINCT d.user_id, d.fhir_id, 
                CONCAT(u.first_name, ' ', u.last_name) AS doctor_name,
                d.speciality AS doctor_speciality,
                MAX(a.appointment_date) AS last_visit
                FROM appointments a
                JOIN doctors d ON a.doctor_id = d.user_id
                JOIN users u ON d.user_id = u.id
                WHERE a.patient_id = ?
                GROUP BY d.user_id, d.fhir_id, u.first_name, u.last_name, d.speciality
                ORDER BY last_visit DESC
                LIMIT 5;
        `, [req.user.patientId]);

        // Format the response
        const dashboardData = {
            appointments: appointments.map(appt => ({
                id: appt.id,
                date: appt.appointment_date,
                time: appt.appointment_time,
                doctor: appt.doctor_name,
                speciality: appt.speciality,
                reason: appt.reason,
                status: appt.status
            })),
            prescriptions: prescriptions.map(pres => ({
                id: pres.id,
                date: pres.prescription_date,
                medication: pres.medication,
                dosage: pres.dosage,
                instructions: pres.instructions,
                doctor: pres.doctor_name
            })),

            availableDoctors: availableDoctors.map(doctor => ({
                id: doctor.user_id,
                name: doctor.doctor_name,
                speciality: doctor.doctor_speciality
            }))
        };

        res.json(dashboardData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get available doctors
router.get('/doctors', authenticateUser, authorizePatient, async (req, res) => {
    try {
        const [doctors] = await pool.query(`
            SELECT id, CONCAT(first_name, ' ', last_name) AS name, speciality
            FROM doctors
            ORDER BY last_name
        `);
        res.json(doctors);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Book appointment
router.post('/appointments', authenticateUser, authorizePatient, async (req, res) => {
    const { doctor_id, appointment_date, appointment_time, reason, duration = 30 } = req.body;

    // Validate input
    if (!doctor_id || !appointment_date || !appointment_time) {
        return res.status(400).json({ error: 'Doctor ID, date, and time are required' });
    }

    try {
        // Check if doctor exists
        const [doctor] = await pool.query('SELECT user_id FROM doctors WHERE user_id = ?', [doctor_id]);
        if (doctor.length === 0) {
            return res.status(404).json({ error: 'Doctor not found' });
        }

        const [seqResult] = await pool.query(
            'SELECT MAX(id) as max_id FROM appointments'
        );
        const nextId = (seqResult[0].max_id || 0) + 1;
        const fhir_id = `appointment-${nextId}`;

        // Calculate end time
        const end_time = new Date(`2000-01-01 ${appointment_time}`);
        end_time.setMinutes(end_time.getMinutes() + (duration || 30));
        const formattedEndTime = end_time.toTimeString().substring(0, 8);

        // Check for time slot availability
        const [existingAppointments] = await pool.query(
            `SELECT id FROM appointments 
                WHERE doctor_id = ? AND appointment_date = ? 
                AND (
                    (appointment_time <= ? AND end_time > ?)
                    OR (appointment_time < ? AND end_time >= ?)
                    OR (appointment_time >= ? AND end_time <= ?)
                )
                AND status NOT IN ('cancelled', 'completed')`,
            [
                doctor_id, appointment_date,
                appointment_time, appointment_time,
                formattedEndTime, formattedEndTime,
                appointment_time, formattedEndTime
            ]
        );

        if (existingAppointments.length > 0) {
            return res.status(409).json({ error: 'Time slot already booked' });
        }

        // Insert appointment
        const [result] = await pool.query(
            `INSERT INTO appointments 
                (fhir_id, patient_id, doctor_id, appointment_date, appointment_time, end_time, duration_minutes, reason, status)
                VALUES (?,?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                fhir_id,
                req.user.patientId,
                doctor_id,
                appointment_date,
                appointment_time,
                formattedEndTime,
                duration || 30,
                reason
            ]
        );

        res.status(201).json({
            message: 'Appointment booked successfully',
            appointmentId: result.insertId,
            fhir_id: fhir_id
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add search endpoint for doctors
router.get('/doctors/search', authenticateUser, authorizePatient, async (req, res) => {
    const { query } = req.query;

    if (!query || query.length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    try {
        const [doctors] = await pool.query(`
            SELECT d.user_id as id, 
                    CONCAT(u.first_name, ' ', u.last_name) AS name,
                    d.speciality,
                    d.years_of_experience
            FROM doctors d
            JOIN users u ON d.user_id = u.id
            WHERE CONCAT(u.first_name, ' ', u.last_name) LIKE ? 
                OR d.speciality LIKE ?
            ORDER BY u.last_name
        `, [`%${query}%`, `%${query}%`]);

        res.json(doctors);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get medical history
router.get('/medical-history', authenticateUser, authorizePatient, async (req, res) => {
    try {
        const [records] = await pool.query(`
            SELECT id, record_date, record_type, description
            FROM medical_records
            WHERE patient_id = ?
            ORDER BY record_date DESC
        `, [req.user.patientId]);

        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/appointments/:id', authenticateUser, authorizePatient, async (req, res) => {
    const appointmentId = req.params.id;

    try {
        const [result] = await pool.query(
            `DELETE FROM appointments WHERE id = ? AND patient_id = ?`,
            [appointmentId, req.user.patientId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Appointment not found or unauthorized' });
        }

        res.json({ message: 'Appointment cancelled' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single prescription
router.get('/prescriptions/:id', authenticateUser, authorizePatient, async (req, res) => {
    try {
        const [prescription] = await pool.query(`
            SELECT p.*, 
                   CONCAT(u.first_name, ' ', u.last_name) AS doctor_name,
                   d.license_number AS doctor_license,
                   CONCAT(up.first_name, ' ', up.last_name) AS patient_name
            FROM prescriptions p
            JOIN doctors d ON p.doctor_id = d.user_id
            JOIN users u ON d.user_id = u.id
            JOIN patients pa ON p.patient_id = pa.user_id
            JOIN users up ON pa.user_id = up.id
            WHERE p.id = ? AND p.patient_id = ?
        `, [req.params.id, req.user.patientId]);

        if (prescription.length === 0) {
            return res.status(404).json({ error: 'Prescription not found' });
        }

        res.json(prescription[0]);
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


module.exports = router;