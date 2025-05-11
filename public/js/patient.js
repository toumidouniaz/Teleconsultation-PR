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
        throw error; // Re-throw for initializeApp to handle
    }
}

// Dashboard rendering
function renderDashboard(data) {
    loadAppointments(data.appointments || []);
    loadPrescriptions(data.prescriptions || []);
    loadDoctors(data.availableDoctors || []);
}

// Load appointments into table
function loadAppointments(appointments) {
    const tableBody = document.getElementById('appointmentsTable');
    tableBody.innerHTML = '';

    if (appointments.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center">No upcoming appointments</td>
            </tr>
        `;
        return;
    }

    appointments.forEach(appt => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(appt.date)}</td>
            <td>${formatTime(appt.time)} - ${formatTime(appt.end_time)}</td>
            <td>${appt.doctor}</td>
            <td>${appt.speciality}</td>
            <td><span class="badge ${getStatusBadgeClass(appt.status)}">${appt.status}</span></td>
            <td>
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
}

// Load prescriptions
function loadPrescriptions(prescriptions) {
    const container = document.getElementById('prescriptionsContainer');
    container.innerHTML = '';

    if (prescriptions.length === 0) {
        container.innerHTML = `
            <div class="alert alert-info">
                No prescriptions found
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
    const doctorName = prescription.doctor_name || (prescription.doctor ? `Dr. ${prescription.doctor}` : 'N/A');

    document.getElementById('prescriptionModalBody').innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <h6>Patient Information</h6>
                <p>${prescription.patient_name || 'N/A'}</p>
            </div>
            <div class="col-md-6 text-end">
                <h6>Prescription Date</h6>
                <p>${formatDate(prescription.prescription_date)}</p>
            </div>
        </div>
        <hr>
        <div class="row mb-3">
            <div class="col-md-6">
                <h6>Medication</h6>
                <p>${prescription.medication}</p>
            </div>
            <div class="col-md-6">
                <h6>Dosage</h6>
                <p>${prescription.dosage}</p>
            </div>
        </div>
        <div class="row mb-3">
            <div class="col-md-6">
                <h6>Frequency</h6>
                <p>${prescription.frequency || 'N/A'}</p>
            </div>
            <div class="col-md-6">
                <h6>Duration</h6>
                <p>${prescription.duration || 'N/A'}</p>
            </div>
        </div>
        <div class="mb-3">
            <h6>Instructions</h6>
            <p>${prescription.instructions || 'None provided'}</p>
        </div>
        <div class="row">
            <div class="col-md-6">
                <h6>Prescribed By</h6>
                <p>Dr. ${doctorName}</p>
            </div>
            <div class="col-md-6 text-end">
                <h6>License Number</h6>
                <p>${prescription.doctor_license || 'N/A'}</p>
            </div>
        </div>
    `;

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
            <div class="col-12 text-center">
                <div class="alert alert-info">No doctors found</div>
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
                    <h5 class="card-title">${doctor.name}</h5>
                    <span class="badge specialty-badge mb-2">${doctor.speciality}</span>
                    ${doctor.years_of_experience ? `<p class="text-muted small">${doctor.years_of_experience} years experience</p>` : ''}
                    <button class="btn btn-sm btn-outline-primary book-btn" 
                            data-doctor-id="${doctor.id}">
                        Book Appointment
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
        showToast(`Appointment booked successfully (FHIR ID: ${result.fhir_id})`, 'success');
        bootstrap.Modal.getInstance(document.getElementById('appointmentModal')).hide();
        loadDashboardData();
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to book appointment', 'error');
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

        const prescriptionDate = prescription.prescription_date || prescription.date;
        const formattedDate = formatDate(prescriptionDate);
        const doctorName = prescription.doctor_name || (prescription.doctor ? `Dr. ${prescription.doctor}` : 'N/A');

        // Add logo or header
        doc.setFontSize(20);
        doc.setTextColor(40, 40, 40);
        doc.text('Tele-Med Prescription', 105, 20, { align: 'center' });

        // Add prescription details
        doc.setFontSize(12);
        doc.text(`Prescription #: ${prescription.id}`, 20, 40);
        doc.text(`Date: ${formattedDate}`, 20, 50);
        doc.text(`Patient: ${prescription.patient_name || 'N/A'}`, 20, 60);

        // Add line separator
        doc.line(20, 65, 190, 65);

        // Add medication details
        doc.setFontSize(14);
        doc.text('Medication Details', 20, 75);
        doc.setFontSize(12);
        doc.text(`Medication: ${prescription.medication}`, 20, 85);
        doc.text(`Dosage: ${prescription.dosage}`, 20, 95);
        doc.text(`Frequency: ${prescription.frequency || 'As directed'}`, 20, 105);
        doc.text(`Duration: ${prescription.duration || 'Until finished'}`, 20, 115);
        doc.text(`Instructions: ${prescription.instructions || 'None provided'}`, 20, 125);

        // Add footer
        doc.line(20, 180, 190, 180);
        doc.setFontSize(10);
        doc.text(`Prescribed by: Dr. ${doctorName}`, 20, 185);
        doc.text(`License: ${prescription.doctor_license || 'N/A'}`, 20, 190);
        doc.text('Tele-Med Electronic Prescription System', 105, 190, { align: 'center' });

        // Save the PDF
        doc.save(`prescription_${prescription.id}.pdf`);
    };
    document.head.appendChild(script);
}

// Helper functions
function formatDate(dateString) {
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

function getStatusBadgeClass(status) {
    switch (status.toLowerCase()) {
        case 'confirmed': return 'bg-success';
        case 'pending': return 'bg-warning text-dark';
        case 'cancelled': return 'bg-danger';
        default: return 'bg-secondary';
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

// Initialize the app
document.addEventListener('DOMContentLoaded', initializeApp);