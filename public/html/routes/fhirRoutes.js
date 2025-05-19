const express = require('express');
const router = express.Router();
const pool = require('../../db');
const fhirUtils = require('../utils/fhirUtils');
const { v4: uuidv4 } = require('uuid');

// Helper to extract ID from FHIR reference
function getLocalId(fhirReference) {
    return fhirReference.split('/')[1];
}

// GET FHIR Patient by ID
router.get('/Patient/:id', async (req, res) => {
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

// GET FHIR Patient with search parameters
router.get('/Patient', async (req, res) => {
    try {
        const { name, gender, birthdate, _count } = req.query;
        let query = 'SELECT * FROM patients WHERE 1=1';
        const params = [];

        if (name) {
            query += ' AND (first_name LIKE ? OR last_name LIKE ?)';
            params.push(`%${name}%`, `%${name}%`);
        }

        if (gender) {
            query += ' AND gender = ?';
            params.push(gender);
        }

        if (birthdate) {
            query += ' AND date_of_birth = ?';
            params.push(birthdate);
        }

        // Limit results
        const limit = _count ? parseInt(_count) : 10;
        query += ' LIMIT ?';
        params.push(limit);

        const [patients] = await pool.query(query, params);

        // Create Bundle resource
        const bundle = {
            resourceType: 'Bundle',
            type: 'searchset',
            total: patients.length,
            entry: patients.map(patient => ({
                resource: fhirUtils.createPatientResource(patient)
            }))
        };

        res.type('application/fhir+json').json(bundle);
    } catch (err) {
        console.error(err);
        res.status(500).json(
            fhirUtils.createOperationOutcome("error", "server-error", "Server error occurred")
        );
    }
});

// POST FHIR Appointment
router.post('/Appointment', async (req, res) => {
    try {
        const fhirAppointment = req.body;

        if (!fhirAppointment.participant || fhirAppointment.participant.length < 2) {
            return res.status(400).json(
                fhirUtils.createOperationOutcome("error", "required", "Appointment must have at least 2 participants")
            );
        }

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

// FHIR Capability Statement
router.get('/metadata', (req, res) => {
    const capabilityStatement = {
        resourceType: 'CapabilityStatement',
        status: 'active',
        date: new Date().toISOString(),
        kind: 'instance',
        software: {
            name: 'Teleconsultation System',
            version: '1.0.0'
        },
        implementation: {
            description: 'Teleconsultation FHIR API'
        },
        fhirVersion: '4.0.1',
        format: ['json'],
        rest: [{
            mode: 'server',
            resource: [
                {
                    type: 'Patient',
                    interaction: [
                        { code: 'read' },
                        { code: 'search-type' }
                    ],
                    searchParam: [
                        { name: 'name', type: 'string' },
                        { name: 'gender', type: 'token' },
                        { name: 'birthdate', type: 'date' }
                    ]
                },
                {
                    type: 'Appointment',
                    interaction: [
                        { code: 'read' },
                        { code: 'create' },
                        { code: 'search-type' }
                    ]
                },
                {
                    type: 'MedicationRequest',
                    interaction: [
                        { code: 'read' },
                        { code: 'create' },
                        { code: 'search-type' }
                    ]
                }
            ]
        }]
    };

    res.type('application/fhir+json').json(capabilityStatement);
});

module.exports = router;
