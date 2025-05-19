const express = require('express');
const router = express.Router();
const pool = require('../../db');
const fhirUtils = require('../utils/fhirUtils');
const { v4: uuidv4 } = require('uuid');
const { authenticateUser, authorizeDoctor } = require('../middlewares/authMiddleware');
const PDFDocument = require('pdfkit');
const fs = require('fs');


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
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['pending', 'confirmed', 'in-progress', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        // Check if appointment exists and belongs to this doctor
        const [appointments] = await pool.query(
            'SELECT * FROM appointments WHERE id = ? AND doctor_id = ?',
            [id, req.user.doctorId]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        // Update appointment status
        await pool.query(
            'UPDATE appointments SET status = ? WHERE id = ?',
            [status, id]
        );

        res.json({ message: 'Appointment status updated successfully' });
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

// Get appointments with filters
router.get('/appointments', authenticateUser, async (req, res) => {
    try {
        const { status, date, start, end, page = 1 } = req.query;
        const doctorId = req.user.id;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Base query
        let query = `
            SELECT
                a.*,
                a.status,
                CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                TIMESTAMPDIFF(YEAR, p.birthdate, CURDATE()) AS patient_age
                FROM
                    appointments a
                JOIN patients p ON a.patient_id = p.user_id
                JOIN users u ON p.user_id = u.id
                WHERE a.doctor_id = ?
        `;

        let params = [doctorId];

        // Status filter
        if (status && status !== 'all') {
            query += ' AND a.status = ?';
            params.push(status);
        }

        // Date filters
        if (date && date !== 'all') {
            const today = new Date().toISOString().split('T')[0];

            switch (date) {
                case 'today':
                    query += ' AND a.appointment_date = ?';
                    params.push(today);
                    break;
                case 'week':
                    query += ' AND YEARWEEK(a.appointment_date, 1) = YEARWEEK(CURDATE(), 1)';
                    break;
                case 'month':
                    query += ' AND YEAR(a.appointment_date) = YEAR(CURDATE()) AND MONTH(a.appointment_date) = MONTH(CURDATE())';
                    break;
                case 'custom':
                    if (start && end) {
                        query += ' AND a.appointment_date BETWEEN ? AND ?';
                        params.push(start, end);
                    }
                    break;
            }
        }

        // Get upcoming appointments (future dates)
        const upcomingQuery = query + ' AND a.appointment_date >= CURDATE() ORDER BY a.appointment_date, a.appointment_time LIMIT 50';
        const [upcoming] = await pool.query(upcomingQuery, params);

        // Get historical appointments (past dates)
        const historyQuery = query + ' AND a.appointment_date < CURDATE() ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT ? OFFSET ?';
        const historyParams = [...params, limit, offset];
        const [history] = await pool.query(historyQuery, historyParams);

        // Get total count for pagination
        const countQuery = query.replace(/SELECT a\.\*, .*?FROM/, 'SELECT COUNT(*) as total FROM');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        res.json({
            upcoming,
            history,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('Error fetching appointments:', err);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

// Get single appointment details
router.get('/appointments/:id', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        const appointmentId = req.params.id;
        const doctorId = req.user.doctorId || req.user.id; // Handle both cases

        console.log(`Fetching appointment ${appointmentId} for doctor ${doctorId}`);

        const [appointments] = await pool.query(`
            SELECT a.*, 
                   CONCAT(pu.first_name, ' ', pu.last_name) AS patient_name,
                   p.user_id AS patient_id,
                   TIMESTAMPDIFF(YEAR, p.birthdate, CURDATE()) AS patient_age
            FROM appointments a
            JOIN patients p ON a.patient_id = p.user_id
            JOIN users pu ON p.user_id = pu.id
            WHERE a.id = ? AND a.doctor_id = ?
        `, [appointmentId, doctorId]);

        if (appointments.length === 0) {
            console.log(`No appointment found with ID ${appointmentId} for doctor ${doctorId}`);
            return res.status(404).json({ error: 'Appointment not found' });
        }

        res.json(appointments[0]);
    } catch (err) {
        console.error('Error fetching appointment:', err);
        res.status(500).json({ error: 'Failed to fetch appointment' });
    }
});


// Update appointment notes
router.put('/appointments/:id/notes', async (req, res) => {
    try {
        const { notes } = req.body;
        const [result] = await pool.query(`
            UPDATE appointments 
            SET notes = ?, updated_at = NOW()
            WHERE id = ? AND doctor_id = ?
        `, [notes, req.params.id, req.user.id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error updating appointment notes:', err);
        res.status(500).json({ error: 'Failed to update appointment notes' });
    }
});


router.get('/prescriptions', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        const [prescriptions] = await pool.query(`
            SELECT 
                p.id, p.fhir_id, p.prescription_date, p.medication, p.dosage, 
                p.frequency, p.duration, p.instructions, p.is_active,
                CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                pt.fhir_id AS patient_fhir_id,
                pt.user_id AS patient_id
            FROM prescriptions p
            JOIN patients pt ON p.patient_id = pt.user_id
            JOIN users u ON pt.user_id = u.id
            WHERE p.doctor_id = ?
            ORDER BY p.prescription_date DESC, p.created_at DESC
        `, [req.user.doctorId]);

        res.json(prescriptions);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/prescriptions/:id/download', authenticateUser, authorizeDoctor, async (req, res) => {
    try {

        const [prescriptions] = await pool.query(`
            SELECT 
                p.id, p.fhir_id, p.prescription_date, p.medication, p.dosage, 
                p.frequency, p.duration, p.instructions, p.is_active,
                CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                CONCAT(du.first_name, ' ', du.last_name) AS doctor_name,
                pt.fhir_id AS patient_fhir_id,
                d.fhir_id AS doctor_fhir_id,
                pt.birthdate AS patient_birthdate,
                pt.blood_type,
                pt.height_cm,
                pt.weight_kg,
                pt.allergies,
                d.speciality,
                d.license_number
            FROM prescriptions p
            JOIN patients pt ON p.patient_id = pt.user_id
            JOIN users u ON pt.user_id = u.id
            JOIN doctors d ON p.doctor_id = d.user_id
            JOIN users du ON d.user_id = du.id
            WHERE p.id = ? AND p.doctor_id = ?
        `, [req.params.id, req.user.doctorId]);

        if (prescriptions.length === 0) {
            return res.status(404).json({ error: 'Prescription not found' });
        }

        const prescription = prescriptions[0];

        // Create PDF
        const doc = new PDFDocument();

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=prescription_${prescription.id}.pdf`);

        // Pipe the PDF to the response
        doc.pipe(res);

        // Add content to the PDF
        doc.fontSize(20).text('Medical Prescription', { align: 'center' });
        doc.moveDown();

        // Add doctor information
        doc.fontSize(14).text('Prescribed by:', { underline: true });
        doc.fontSize(12).text(`Dr. ${prescription.doctor_name}`);
        doc.text(`Speciality: ${prescription.speciality}`);
        doc.text(`License: ${prescription.license_number}`);
        doc.moveDown();

        // Add patient information
        doc.fontSize(14).text('Patient Information:', { underline: true });
        doc.fontSize(12).text(`Name: ${prescription.patient_name}`);
        doc.text(`Date of Birth: ${formatDate(prescription.patient_birthdate)}`);
        doc.text(`Blood Type: ${prescription.blood_type || 'Unknown'}`);
        doc.text(`Height: ${prescription.height_cm || 'N/A'} cm`);
        doc.text(`Weight: ${prescription.weight_kg || 'N/A'} kg`);
        doc.text(`Allergies: ${prescription.allergies || 'None reported'}`);
        doc.moveDown();

        // Add prescription details
        doc.fontSize(14).text('Prescription Details:', { underline: true });
        doc.fontSize(12).text(`Date: ${formatDate(prescription.prescription_date)}`);
        doc.moveDown();

        doc.fontSize(16).text('Medication:', { underline: true });
        doc.fontSize(14).text(prescription.medication);
        doc.moveDown();

        doc.fontSize(14).text('Dosage:', { underline: true });
        doc.text(prescription.dosage);
        doc.moveDown();

        doc.fontSize(14).text('Frequency:', { underline: true });
        doc.text(prescription.frequency || 'As directed');
        doc.moveDown();

        doc.fontSize(14).text('Duration:', { underline: true });
        doc.text(prescription.duration || 'Until finished');
        doc.moveDown();

        if (prescription.instructions) {
            doc.fontSize(14).text('Special Instructions:', { underline: true });
            doc.text(prescription.instructions);
            doc.moveDown();
        }

        // Add footer
        doc.fontSize(10).text('This is an electronically generated prescription. No signature required.', { align: 'center' });

        // Finalize the PDF
        doc.end();

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add this new route to doctorRoutes.js
router.get('/quick-stats', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        // Get doctor's name
        const [[doctor]] = await pool.query(`
            SELECT CONCAT(u.first_name, ' ', u.last_name) AS name 
            FROM doctors d
            JOIN users u ON d.user_id = u.id
            WHERE d.user_id = ?
        `, [req.user.id]);

        // Get today's appointment count
        const [[todayCount]] = await pool.query(`
            SELECT COUNT(*) AS count 
            FROM appointments 
            WHERE doctor_id = ? AND appointment_date = CURDATE()
        `, [req.user.doctorId]);

        // Get pending requests count
        const [[pendingCount]] = await pool.query(`
            SELECT COUNT(*) AS count 
            FROM appointments 
            WHERE doctor_id = ? AND status = 'pending'
        `, [req.user.doctorId]);

        // Get total patients count
        const [[patientCount]] = await pool.query(`
            SELECT COUNT(DISTINCT patient_id) AS count 
            FROM appointments 
            WHERE doctor_id = ?
        `, [req.user.doctorId]);

        // Get active prescriptions count
        const [[prescriptionCount]] = await pool.query(`
            SELECT COUNT(*) AS count 
            FROM prescriptions 
            WHERE doctor_id = ? AND is_active = 1
        `, [req.user.doctorId]);

        // Get average consultation time (mock data for now)
        const avgConsultationTime = "15-20 mins";

        res.json({
            doctorName: doctor?.name || 'Doctor',
            todaysAppointments: todayCount?.count || 0,
            pendingRequests: pendingCount?.count || 0,
            totalPatients: patientCount?.count || 0,
            activePrescriptions: prescriptionCount?.count || 0,
            avgConsultationTime
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/prescriptions/:id', authenticateUser, authorizeDoctor, async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;

    try {
        const [result] = await pool.query(
            `UPDATE prescriptions 
             SET is_active = ?, updatedAt = CURRENT_TIMESTAMP 
             WHERE id = ? AND doctor_id = ?`,
            [is_active, id, req.user.doctorId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Prescription not found' });
        }

        res.json({ message: `Prescription ${is_active ? 'activated' : 'deactivated'} successfully` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Helper function to format dates
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Get all patients for a doctor
router.get('/patients', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        const { search } = req.query;

        let query = `
            SELECT 
                p.user_id, p.fhir_id, p.age, p.blood_type, p.height_cm, p.weight_kg,
                CONCAT(u.first_name, ' ', u.last_name) AS name,
                u.email, u.phone, u.address,
                p.birthdate, p.allergies,
                MAX(a.appointment_date) AS last_visit
            FROM patients p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN appointments a ON p.user_id = a.patient_id AND a.doctor_id = ?
            WHERE p.DoctorUserId = ?
        `;

        const params = [req.user.doctorId, req.user.doctorId];

        if (search) {
            query += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += ` GROUP BY p.user_id`;

        const [patients] = await pool.query(query, params);
        res.json(patients);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});


router.post('/patients/assign', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        const { patientIds } = req.body;

        if (!patientIds || !Array.isArray(patientIds) || patientIds.length === 0) {
            return res.status(400).json({ error: 'Please provide patient IDs' });
        }

        // First verify all patients exist
        const [patients] = await pool.query(
            `SELECT user_id FROM patients WHERE user_id IN (?)`,
            [patientIds]
        );

        if (patients.length !== patientIds.length) {
            return res.status(400).json({ error: 'One or more patient IDs are invalid' });
        }

        // Update all specified patients
        await pool.query(
            `UPDATE patients SET DoctorUserId = ?, updatedAt = NOW() WHERE user_id IN (?)`,
            [req.user.doctorId, patientIds]
        );

        res.json({ success: true, message: `${patientIds.length} patients assigned successfully` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/patients/unassigned', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        const { search } = req.query;

        let query = `
            SELECT 
                p.user_id, p.fhir_id,
                CONCAT(u.first_name, ' ', u.last_name) AS name,
                u.email, u.phone
            FROM patients p
            JOIN users u ON p.user_id = u.id
            WHERE p.DoctorUserId IS NULL
        `;

        const params = [];

        if (search) {
            query += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += ` LIMIT 50`;

        const [patients] = await pool.query(query, params);
        res.json(patients);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single patient details
router.get('/patients/:id', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        const [patients] = await pool.query(`
            SELECT 
                p.user_id, p.fhir_id, p.age, p.blood_type, p.height_cm, p.weight_kg,
                CONCAT(u.first_name, ' ', u.last_name) AS name,
                u.email, u.phone, u.address,
                p.birthdate, p.allergies,
                MAX(a.appointment_date) AS last_visit
            FROM patients p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN appointments a ON p.user_id = a.patient_id AND a.doctor_id = ?
            WHERE p.user_id = ? AND p.DoctorUserId = ?
            GROUP BY p.user_id
        `, [req.user.doctorId, req.params.id, req.user.doctorId]);

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        res.json(patients[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add to fhirUtils.js:
fhirUtils.generateFhirId = () => uuidv4();

// Save consultation notes
router.post('/appointments/:id/notes', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        const { id } = req.params;
        const { subjective, objective, assessment, plan } = req.body;

        // Check if appointment exists and belongs to this doctor
        const [appointments] = await pool.query(
            'SELECT * FROM appointments WHERE id = ? AND doctor_id = ?',
            [id, req.user.doctorId]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        // Check if notes already exist
        const [existingNotes] = await pool.query(
            'SELECT * FROM consultation_notes WHERE appointment_id = ?',
            [id]
        );

        if (existingNotes.length > 0) {
            // Update existing notes
            await pool.query(
                `UPDATE consultation_notes 
                 SET subjective = ?, objective = ?, assessment = ?, plan = ?, updated_at = NOW() 
                 WHERE appointment_id = ?`,
                [
                    subjective || existingNotes[0].subjective,
                    objective || existingNotes[0].objective,
                    assessment || existingNotes[0].assessment,
                    plan || existingNotes[0].plan,
                    id
                ]
            );
        } else {
            // Create new notes with FHIR ID
            const fhirId = require('uuid').v4();
            await pool.query(
                `INSERT INTO consultation_notes 
                 (fhir_id, appointment_id, patient_id, doctor_id, subjective, objective, assessment, plan) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    fhirId,
                    id,
                    appointments[0].patient_id,
                    req.user.doctorId,
                    subjective || null,
                    objective || null,
                    assessment || null,
                    plan || null
                ]
            );
        }

        res.json({ success: true, message: 'Consultation notes saved successfully' });
    } catch (err) {
        console.error('Error saving consultation notes:', err);
        res.status(500).json({ error: 'Failed to save consultation notes' });
    }
});

// Get appointment details
router.get('/appointments/:id', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        // First, log the doctor ID for debugging
        console.log(`Doctor ID: ${req.user.id}, Looking for appointment: ${req.params.id}`);

        // Check if the appointment exists at all
        const [allAppointments] = await pool.query(`
            SELECT a.*, 
                   CONCAT(pu.first_name, ' ', pu.last_name) AS patient_name,
                   CONCAT(du.first_name, ' ', du.last_name) AS doctor_name,
                   p.age AS patient_age,
                   p.user_id AS patient_id
            FROM appointments a
            JOIN patients p ON a.patient_id = p.user_id
            JOIN users pu ON p.user_id = pu.id
            JOIN doctors d ON a.doctor_id = d.user_id
            JOIN users du ON d.user_id = du.id
            WHERE a.id = ?
        `, [req.params.id]);

        if (allAppointments.length === 0) {
            return res.status(404).json({ error: 'Appointment does not exist' });
        }

        console.log(`Appointment found. Doctor ID in DB: ${allAppointments[0].doctor_id}, Logged in doctor: ${req.user.id}`);

        // Now check if this doctor is associated with the appointment
        const [appointments] = await pool.query(`
            SELECT a.*, 
                   CONCAT(pu.first_name, ' ', pu.last_name) AS patient_name,
                   CONCAT(du.first_name, ' ', du.last_name) AS doctor_name,
                   p.age AS patient_age,
                   p.user_id AS patient_id
            FROM appointments a
            JOIN patients p ON a.patient_id = p.user_id
            JOIN users pu ON p.user_id = pu.id
            JOIN doctors d ON a.doctor_id = d.user_id
            JOIN users du ON d.user_id = du.id
            WHERE a.id = ? AND a.doctor_id = ?
        `, [req.params.id, req.user.id]);

        if (appointments.length === 0) {
            // For development purposes, temporarily return the appointment anyway
            // In production, you would keep the 404 response
            console.log('Doctor not associated with this appointment, but returning data anyway for development');
            return res.json(allAppointments[0]);
            // return res.status(404).json({ error: 'Appointment not found for this doctor' });
        }

        res.json(appointments[0]);
    } catch (err) {
        console.error('Error fetching appointment:', err);
        res.status(500).json({ error: 'Failed to fetch appointment' });
    }
});

// Get consultation notes
router.get('/appointments/:id/notes', authenticateUser, authorizeDoctor, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if appointment exists and belongs to this doctor
        const [appointments] = await pool.query(
            'SELECT * FROM appointments WHERE id = ? AND doctor_id = ?',
            [id, req.user.doctorId]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        // Get consultation notes
        const [notes] = await pool.query(
            'SELECT * FROM consultation_notes WHERE appointment_id = ?',
            [id]
        );

        if (notes.length === 0) {
            return res.status(404).json({ error: 'Consultation notes not found' });
        }

        res.json(notes[0]);
    } catch (err) {
        console.error('Error retrieving consultation notes:', err);
        res.status(500).json({ error: 'Failed to retrieve consultation notes' });
    }
});

module.exports = router;
