let socket = null;
let currentUser = null;

window.showToast = showToast;

// Central authentication verification
async function verifyAuthentication() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            throw new Error('No authentication token found');
        }

        // Decode token to get user info
        currentUser = JSON.parse(atob(token.split('.')[1]));

        // Verify token with server
        const response = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: 'include'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Authentication failed');
        }

        return { token, user: currentUser };
    } catch (error) {
        console.error('Authentication check failed:', error);
        clearAuthData();
        window.location.href = '/login';
        return null;
    }
}

function clearAuthData() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userId');
    currentUser = null;
}

// Main initialization flow
async function initializeApp() {
    try {
        // 1. Verify authentication
        const auth = await verifyAuthentication();
        if (!auth) return;

        // Set patient name
        document.getElementById('patientName').textContent = auth.user.name || 'Patient';

        // 2. Load dashboard data
        await loadDashboardData();
    } catch (error) {
        console.error('App initialization failed:', error);
        clearAuthData();
        window.location.href = '/login';
    }
}

// Dashboard data loading
async function loadDashboardData() {
    try {
        const response = await fetch('/api/patient/dashboard', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        if (response.status === 401) {
            throw new Error('Session expired');
        }

        if (!response.ok) {
            throw new Error(`Dashboard request failed: ${response.status}`);
        }

        const data = await response.json();
        renderDashboard(data);
    } catch (error) {
        console.error('Dashboard load error:', error);
        showToast(error.message, 'error');
        throw error;
    }
}

// Dashboard rendering
function renderDashboard(data) {
    document.getElementById('patientName').textContent = data.patient.fullName;

    // Set allergies - handles null/undefined cases
    document.getElementById('allergiesText').textContent =
        data.patient.allergies || 'None recorded';

    // Add click handler to edit allergies
    document.getElementById('allergiesText').style.cursor = 'pointer';
    document.getElementById('allergiesText').addEventListener('click', openEditAllergiesModal);
    // Update header stats
    updateHeaderStats(data);

    // Load appointments, prescriptions, and doctors
    loadAppointments(data.appointments || []);
    loadPrescriptions(data.prescriptions || []);
    loadDoctors(data.availableDoctors || []);
}

// Update header stats
function updateHeaderStats(data) {
    // Next appointment
    const nextAppointment = data.appointments?.[0];
    if (nextAppointment) {
        const apptDate = formatDate(nextAppointment.date);
        const apptTime = formatTime(nextAppointment.time);
        document.getElementById('nextAppointmentDate').textContent = `${apptDate} at ${apptTime}`;
    } else {
        document.getElementById('nextAppointmentDate').textContent = 'No upcoming';
    }

    // Active prescriptions count
    const activePrescriptions = data.prescriptions?.length || 0;
    document.getElementById('activePrescriptionsCount').textContent = activePrescriptions;
    document.getElementById('activePrescriptionsText').textContent =
        activePrescriptions === 1 ? '1 medication' : `${activePrescriptions} medications`;

    // Last checkup date (using most recent appointment if available)
    const lastAppointment = data.appointments?.length > 0 ?
        data.appointments[data.appointments.length - 1] : null;
    if (lastAppointment) {
        document.getElementById('lastCheckupDate').textContent = formatDate(lastAppointment.date);
    } else {
        document.getElementById('lastCheckupDate').textContent = 'No recent checkups';
    }

    document.getElementById('saveAllergiesBtn')?.addEventListener('click', saveAllergies);
}

// Load appointments into table
function loadAppointments(appointments) {
    const tableBody = document.getElementById('appointmentsTable');
    tableBody.innerHTML = '';

    if (appointments.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state py-4">
                        <i class="bi bi-calendar-x"></i>
                        <h5>No upcoming appointments</h5>
                        <p>You don't have any scheduled appointments right now.</p>
                        <button class="btn btn-primary" id="bookAppointmentBtn">
                            <i class="bi bi-plus-circle"></i> Book Appointment
                        </button>
                    </div>
                </td>
            </tr>
        `;
        document.getElementById('bookAppointmentBtn').addEventListener('click', () => {
            window.location.href = '/patient/appointments';
        });
        return;
    }

    appointments.forEach(appt => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(appt.date)} ${formatTime(appt.time)}</td>
            <td>${appt.doctor}</td>
            <td>${appt.speciality}</td>
            <td><span class="status-badge ${getStatusClass(appt.status)}">${appt.status}</span></td>
            <td class="appointment-actions">
                ${appt.status === 'confirmed' ? `
                <button class="btn btn-sm btn-success join-btn" 
                        data-appointment-id="${appt.id}">
                    Join
                </button>
                ` : ''}
                <button class="btn btn-sm btn-outline-danger cancel-btn" 
                        data-appointment-id="${appt.id}">
                    Cancel
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    // Add event listeners to cancel buttons
    document.querySelectorAll('.cancel-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const appointmentId = this.getAttribute('data-appointment-id');
            cancelAppointment(appointmentId);
        });
    });

    // Add event listeners to join buttons
    document.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const appointmentId = this.getAttribute('data-appointment-id');
            window.location.href = `/consultation?appointmentId=${appointmentId}`;
        });
    });
}

// Fetch and display allergies
async function loadAllergies() {
    try {
        const response = await fetch('/api/patient/allergies', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load allergies');
        }

        const data = await response.json();
        document.getElementById('allergiesText').textContent = data.allergies;
    } catch (error) {
        console.error('Error loading allergies:', error);
        document.getElementById('allergiesText').textContent = 'Error loading allergies';
    }
}

// Open edit allergies modal
function openEditAllergiesModal() {
    const currentAllergies = document.getElementById('allergiesText').textContent;
    document.getElementById('editAllergiesInput').value =
        currentAllergies === 'None recorded' ? '' : currentAllergies;

    const modal = new bootstrap.Modal(document.getElementById('editAllergiesModal'));
    modal.show();
}

// Save allergies
async function saveAllergies() {
    const newAllergies = document.getElementById('editAllergiesInput').value.trim();

    try {
        const response = await fetch('/api/patient/allergies', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                allergies: newAllergies || null
            })
        });

        if (!response.ok) {
            throw new Error('Failed to update allergies');
        }

        const data = await response.json();
        document.getElementById('allergiesText').textContent = data.allergies;
        showToast('Allergies updated successfully', 'success');

        bootstrap.Modal.getInstance(document.getElementById('editAllergiesModal')).hide();
    } catch (error) {
        console.error('Error saving allergies:', error);
        showToast(error.message || 'Failed to update allergies', 'error');
    }
}

// Load prescriptions
function loadPrescriptions(prescriptions) {
    const container = document.getElementById('prescriptionsContainer');
    container.innerHTML = '';

    if (prescriptions.length === 0) {
        container.innerHTML = `
            <div class="empty-state py-4">
                <i class="bi bi-file-medical"></i>
                <h5>No active prescriptions</h5>
                <p>You don't have any active prescriptions at the moment.</p>
            </div>
        `;
        return;
    }

    prescriptions.forEach(pres => {
        const card = document.createElement('div');
        card.className = 'card mb-3 prescription-card';
        card.setAttribute('data-prescription-id', pres.id);
        card.innerHTML = `
            <div class="card-body">
                <h5 class="card-title">${pres.medication}</h5>
                <h6 class="card-subtitle mb-2 text-muted">
                    Prescribed on ${formatDate(pres.date)} by Dr. ${pres.doctor}
                </h6>
                <p class="card-text">
                    <strong>Dosage:</strong> ${pres.dosage}<br>
                    <strong>Instructions:</strong> ${pres.instructions || 'None provided'}
                </p>
            </div>
        `;
        container.appendChild(card);
    });

    document.querySelectorAll('.prescription-card').forEach(card => {
        card.addEventListener('click', function () {
            const prescriptionId = this.getAttribute('data-prescription-id');
            viewPrescriptionDetails(prescriptionId);
        });
    });
}

// View prescription details
async function viewPrescriptionDetails(prescriptionId) {
    try {
        const response = await fetch(`/api/patient/prescriptions/${prescriptionId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Failed to load prescription');

        const prescription = await response.json();
        showPrescriptionModal(prescription);
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to load prescription', 'error');
    }
}

// Show prescription in modal
function showPrescriptionModal(prescription) {
    const modal = new bootstrap.Modal(document.getElementById('prescriptionModal'));
    document.getElementById('prescriptionModalTitle').textContent = `Prescription #${prescription.id}`;

    // Set patient and prescription info
    document.getElementById('patientInfo').innerHTML = `
        <strong>Name:</strong> ${prescription.patient_name || 'N/A'}<br>
        <strong>Date of Birth:</strong> ${prescription.dob || 'N/A'}<br>
        <strong>Gender:</strong> ${prescription.gender || 'N/A'}
    `;

    document.getElementById('prescriptionDetails').innerHTML = `
        <strong>Date:</strong> ${formatDate(prescription.prescription_date)}<br>
        <strong>Prescribed by:</strong> Dr. ${prescription.doctor_name}<br>
        <strong>License:</strong> ${prescription.doctor_license || 'N/A'}
    `;

    // Set medications table
    const medicationsBody = document.getElementById('prescriptionMedications');
    medicationsBody.innerHTML = `
        <tr>
            <td>${prescription.medication}</td>
            <td>${prescription.dosage}</td>
            <td>${prescription.frequency || 'As directed'}</td>
            <td>${prescription.duration || 'Until finished'}</td>
            <td>${prescription.instructions || 'None provided'}</td>
        </tr>
    `;

    // Set additional notes
    document.getElementById('prescriptionNotes').textContent =
        prescription.notes || 'No additional notes provided.';

    // Store current prescription for PDF download
    document.getElementById('prescriptionModal').dataset.currentPrescription = JSON.stringify(prescription);
    modal.show();
}

// Load available doctors into the UI
function loadDoctors(doctors) {
    const container = document.getElementById('doctorsList');
    container.innerHTML = '';

    if (doctors.length === 0) {
        container.innerHTML = `
            <div class="col-12">
                <div class="empty-state py-4">
                    <i class="bi bi-person-x"></i>
                    <h5>No doctors available</h5>
                    <p>There are currently no doctors available in your network.</p>
                </div>
            </div>
        `;
        return;
    }

    doctors.forEach(doctor => {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4 mb-4';
        col.innerHTML = `
            <div class="card doctor-card h-100">
                <div class="card-body">
                    <h5 class="card-title">Dr. ${doctor.name}</h5>
                    <span class="specialty-badge">${doctor.speciality}</span>
                    <p class="card-text mt-2">
                        <small class="text-muted">
                            <i class="bi bi-briefcase"></i> ${doctor.years_of_experience || 'N/A'} years experience
                        </small>
                    </p>
                    <button class="btn btn-sm btn-primary book-btn mt-3" 
                            data-doctor-id="${doctor.id}">
                        <i class="bi bi-calendar-plus"></i> Book Appointment
                    </button>
                </div>
            </div>
        `;
        container.appendChild(col);
    });

    // Add event listeners to book buttons
    document.querySelectorAll('.book-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const doctorId = this.getAttribute('data-doctor-id');
            const doctorName = this.closest('.card-body').querySelector('.card-title').textContent;
            openAppointmentModal(doctorId, doctorName);
        });
    });
}

// Open appointment modal with doctor info
function openAppointmentModal(doctorId, doctorName) {
    const modal = new bootstrap.Modal(document.getElementById('appointmentModal'));
    document.getElementById('doctorId').value = doctorId;
    document.querySelector('.modal-title').textContent = `Book Appointment with ${doctorName}`;

    // Set minimum date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('appointmentDate').min = today;

    // Reset form values
    document.getElementById('appointmentDate').value = '';
    document.getElementById('appointmentTime').value = '';
    document.getElementById('appointmentDuration').value = '30';
    document.getElementById('appointmentReason').value = '';

    modal.show();
}

// Cancel appointment
async function cancelAppointment(appointmentId) {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    try {
        const response = await fetch(`/api/patient/appointments/${appointmentId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Cancellation failed');
        }

        showToast('Appointment cancelled successfully', 'success');
        loadDashboardData();
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to cancel appointment', 'error');
    }
}

// Book appointment
async function bookAppointment(doctorId, date, time, reason) {
    if (!date || !time) {
        showToast('Please select both date and time', 'error');
        return;
    }

    const duration = parseInt(document.getElementById('appointmentDuration').value) || 30;

    try {
        const response = await fetch('/api/patient/appointments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                doctor_id: doctorId,
                appointment_date: date,
                appointment_time: time,
                reason: reason,
                duration: duration
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Booking failed');
        }

        const result = await response.json();
        showToast(`Appointment booked successfully`, 'success');
        bootstrap.Modal.getInstance(document.getElementById('appointmentModal')).hide();
        loadDashboardData();
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to book appointment', 'error');
    }
}

// Helper functions
function formatDate(dateString) {
    if (!dateString) return '';
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
}

function formatTime(timeString) {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
}

function getStatusClass(status) {
    switch (status.toLowerCase()) {
        case 'confirmed': return 'status-confirmed';
        case 'pending': return 'status-pending';
        case 'cancelled': return 'status-cancelled';
        default: return '';
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast show position-fixed top-0 end-0 m-3 bg-${type === 'error' ? 'danger' : 'success'} text-white`;
    toast.style.zIndex = '1100';
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Event listeners
document.getElementById('confirmAppointment')?.addEventListener('click', async function () {
    const doctorId = document.getElementById('doctorId').value;
    const date = document.getElementById('appointmentDate').value;
    const time = document.getElementById('appointmentTime').value;
    const reason = document.getElementById('appointmentReason').value;

    await bookAppointment(doctorId, date, time, reason);
});

document.getElementById('searchDoctorsBtn')?.addEventListener('click', function () {
    const query = document.getElementById('doctorSearch').value.trim();
    if (query.length >= 2) {
        searchDoctors(query);
    } else {
        showToast('Please enter at least 2 characters', 'error');
    }
});

document.getElementById('resetSearchBtn')?.addEventListener('click', function () {
    document.getElementById('doctorSearch').value = '';
    loadDashboardData();
});

document.getElementById('doctorSearch')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        document.getElementById('searchDoctorsBtn').click();
    }
});

document.getElementById('downloadPrescriptionPdf')?.addEventListener('click', function () {
    const prescription = JSON.parse(document.getElementById('prescriptionModal').dataset.currentPrescription);
    generatePrescriptionPdf(prescription);
});

document.getElementById('startTestConsultation')?.addEventListener('click', function () {
    const appointmentId = document.getElementById('testAppointmentId').value.trim();
    if (!appointmentId) {
        showToast('Please enter an appointment ID', 'error');
        return;
    }
    window.location.href = `/consultation?appointmentId=${appointmentId}`;
});

// Initialize the app
document.addEventListener('DOMContentLoaded', initializeApp);

// Search doctors function
async function searchDoctors(query) {
    try {
        const response = await fetch(`/api/patient/doctors/search?query=${encodeURIComponent(query)}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Search failed');

        const doctors = await response.json();
        loadDoctors(doctors);
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Search failed', 'error');
    }
}

// Generate PDF using jsPDF
function generatePrescriptionPdf(prescription) {
    // Load jsPDF library dynamically
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = function () {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Add prescription details to PDF
        doc.text(`Prescription #${prescription.id}`, 20, 20);
        doc.text(`Date: ${formatDate(prescription.prescription_date)}`, 20, 30);
        doc.text(`Patient: ${prescription.patient_name}`, 20, 40);
        doc.text(`Prescribed by: Dr. ${prescription.doctor_name}`, 20, 50);

        // Add medication details
        doc.text('Medication:', 20, 70);
        doc.text(`${prescription.medication} - ${prescription.dosage}`, 30, 80);
        doc.text(`Frequency: ${prescription.frequency || 'As directed'}`, 30, 90);
        doc.text(`Duration: ${prescription.duration || 'Until finished'}`, 30, 100);
        doc.text(`Instructions: ${prescription.instructions || 'None provided'}`, 30, 110);

        // Save the PDF
        doc.save(`prescription_${prescription.id}.pdf`);
    };
    document.head.appendChild(script);
}