const express = require('express');
const router = express.Router();
const path = require('path');
const { route } = require('./doctorRoutes');

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/index.html'));
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/auth/login.html'));
});

router.get('/register', (req, res) => {
    const type = req.query.type;
    const registerPage = type === 'doctor'
        ? 'register_doctor.html'
        : 'register_patient.html';
    res.sendFile(path.join(__dirname, '../../public/html/auth', registerPage));
});

router.get('/patient/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/patient_dashboard.html'));
});

router.get('/doctor/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/doctor_dashboard.html'));
});

router.get('/doctor/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/chat.html'));
});

router.get('/patient/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/chat.html'));
});

router.get('/doctor/appointments', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/doctor_appointment.html'));
});

router.get('/doctor/prescriptions', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/doctor_prescreption.html'));
});

router.get('/doctor/patients', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/patients.html'));
});

router.get('/patient/prescriptions', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/patient_prescription.html'));
});

router.get('/patient/appointments', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/patient_appointment.html'));
});

// Add consultation route for both doctor and patient
router.get('/consultation', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/consultation.html'));
});

// Add this route to your static routes
router.get('/test-consultation', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/html/test_consultation.html'));
});

module.exports = router;
