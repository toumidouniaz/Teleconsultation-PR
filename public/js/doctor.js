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
        const response = await fetch('/api/doctor/dashboard', {
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
    loadAppointments(data.todayAppointments || [], data.upcomingAppointments || []);
    loadPatients(data.recentPatients || []);
    loadPendingRequests(data.pendingRequests || []);
}

// Add these helper functions if you don't have them:
function formatTime(timeStr) {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
}

function formatDate(dateStr) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateStr).toLocaleDateString(undefined, options);
}

// Process FHIR Bundle response
function processFhirBundle(bundle) {
    if (!bundle.entry) return;

    const todayAppointments = [];
    const upcomingAppointments = [];
    const patients = [];
    const today = new Date().toISOString().split('T')[0];

    bundle.entry.forEach(entry => {
        switch (entry.resource.resourceType) {
            case 'Appointment':
                const appointment = parseAppointment(entry.resource);
                if (appointment.date === today) {
                    todayAppointments.push(appointment);
                } else {
                    upcomingAppointments.push(appointment);
                }
                break;
            case 'Patient':
                patients.push(parsePatient(entry.resource));
                break;
        }
    });

    loadAppointments(todayAppointments, upcomingAppointments);
    loadPatients(patients);
}

// Parse FHIR Appointment
function parseAppointment(fhirAppointment) {
    const start = new Date(fhirAppointment.start);
    return {
        id: fhirAppointment.id,
        date: start.toISOString().split('T')[0],
        time: start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        patient: getParticipantName(fhirAppointment.participant, 'Patient'),
        age: calculateAgeFromReference(fhirAppointment.participant[0].actor.reference),
        reason: fhirAppointment.serviceType?.[0]?.coding?.[0]?.display || 'Consultation',
        status: mapFhirStatus(fhirAppointment.status)
    };
}

// Parse FHIR Patient
function parsePatient(fhirPatient) {
    return {
        id: fhirPatient.id,
        name: `${fhirPatient.name?.[0]?.given?.[0]} ${fhirPatient.name?.[0]?.family}`,
        age: calculateAge(fhirPatient.birthDate),
        lastVisit: getLastVisitDate(fhirPatient.id) // Would need additional API call
    };
}

// Load appointments
function loadAppointments(todayAppts, upcomingAppts) {
    const todaysAppointments = document.getElementById('todaysAppointments');
    const upcomingAppointments = document.getElementById('upcomingAppointments');

    todaysAppointments.innerHTML = todayAppts.length ? '' :
        '<tr><td colspan="5" class="text-center">No appointments today</td></tr>';

    upcomingAppointments.innerHTML = upcomingAppts.length ? '' :
        '<tr><td colspan="5" class="text-center">No upcoming appointments</td></tr>';

    todayAppts.forEach(appt => {
        const row = document.createElement('tr');
        row.innerHTML = `
                <td>${appt.time}</td>
                <td>${appt.patient}</td>
                <td>${appt.reason}</td>
                <td><span class="badge ${getStatusBadgeClass(appt.status)}">${appt.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-success start-btn" data-appointment-id="${appt.id}">
                        Start
                    </button>
                </td>
            `;
        todaysAppointments.appendChild(row);
    });

    upcomingAppts.forEach(appt => {
        const row = document.createElement('tr');
        row.innerHTML = `
                <td>${appt.date} at ${appt.time}</td>
                <td>${appt.patient}</td>
                <td>${appt.age}</td>
                <td>${appt.reason}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary details-btn" data-appointment-id="${appt.id}">
                        Details
                    </button>
                    <button class="btn btn-sm btn-outline-danger cancel-btn" data-appointment-id="${appt.id}">
                        Cancel
                    </button>
                </td>
            `;
        upcomingAppointments.appendChild(row);
    });
}

function loadPendingRequests(requests) {
    const container = document.getElementById('pendingRequestsContainer');
    if (!container) return;

    container.innerHTML = '';

    if (requests.length === 0) {
        container.innerHTML = `
            <div class="alert alert-info">
                No pending appointment requests
            </div>
        `;
        return;
    }

    requests.forEach(req => {
        const card = document.createElement('div');
        card.className = 'card mb-3';
        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between">
                    <div>
                        <h5 class="card-title">${req.patient} (${req.age})</h5>
                        <h6 class="card-subtitle mb-2 text-muted">
                            Requested: ${formatDate(req.date)} at ${formatTime(req.time)}
                        </h6>
                        <p class="card-text">${req.reason}</p>
                    </div>
                    <div class="d-flex align-items-center">
                        <button class="btn btn-success btn-sm me-2 accept-btn" 
                                data-request-id="${req.id}">
                            Accept
                        </button>
                        <button class="btn btn-danger btn-sm reject-btn" 
                                data-request-id="${req.id}">
                            Reject
                        </button>
                    </div>
                </div>
                <small class="text-muted">FHIR ID: ${req.fhir_id}</small>
            </div>
        `;
        container.appendChild(card);
    });

    // Add event listeners
    document.querySelectorAll('.accept-btn').forEach(btn => {
        btn.addEventListener('click', () => updateAppointmentStatus(
            btn.getAttribute('data-request-id'),
            'confirmed'
        ));
    });

    document.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', () => updateAppointmentStatus(
            btn.getAttribute('data-request-id'),
            'cancelled'
        ));
    });
}

// Load patients
function loadPatients(patients) {
    const patientsList = document.getElementById('patientsList');
    patientsList.innerHTML = '';

    if (patients.length === 0) {
        patientsList.innerHTML = '<div class="col-12 text-center">No patients found</div>';
        return;
    }

    patients.forEach(patient => {
        const patientCard = document.createElement('div');
        patientCard.className = 'col-md-4 mb-4';
        patientCard.innerHTML = `
                <div class="card patient-card h-100">
                    <div class="card-body">
                        <h5 class="card-title">${patient.name}</h5>
                        <h6 class="card-subtitle mb-2 text-muted">Age: ${patient.age}</h6>
                        <p class="card-text">
                            <small>Last visit: ${patient.lastVisit || 'N/A'}</small>
                        </p>
                    </div>
                    <div class="card-footer bg-transparent">
                        <button class="btn btn-success btn-sm prescription-btn" 
                                data-patient-id="${patient.db_id}" 
                                data-patient-name="${patient.name}">
                            New Prescription
                        </button>
                    </div>
                </div>
            `;
        patientsList.appendChild(patientCard);
    });

    // Add prescription button listeners
    document.querySelectorAll('.prescription-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const patientId = this.getAttribute('data-patient-id');
            const patientName = this.getAttribute('data-patient-name');
            document.getElementById('patientId').value = patientId;
            document.getElementById('prescriptionModal').querySelector('.modal-title')
                .textContent = `Prescription for ${patientName}`;
            new bootstrap.Modal(document.getElementById('prescriptionModal')).show();
        });
    });
}

async function updateAppointmentStatus(appointmentId, status) {
    if (!confirm(`Are you sure you want to ${status} this appointment?`)) return;

    try {
        const response = await fetch(`/api/doctor/appointments/${appointmentId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ status })
        });

        if (!response.ok) throw new Error('Status update failed');

        showToast(`Appointment ${status} successfully`, 'success');
        loadDashboardData(); // Refresh the dashboard
    } catch (error) {
        console.error(error);
        showToast(`Failed to ${status} appointment`, 'error');
    }
}

// Handle prescription creation
document.getElementById('confirmPrescription').addEventListener('click', async function () {
    const patientId = document.getElementById('patientId').value;
    const medication = document.getElementById('prescriptionMedication').value;
    const dosage = document.getElementById('prescriptionDosage').value;
    const frequency = document.getElementById('prescriptionFrequency').value;
    const duration = document.getElementById('prescriptionDuration').value;
    const instructions = document.getElementById('prescriptionInstructions').value;

    if (!medication || !dosage || !frequency || !duration) {
        showToast('Please fill in required fields', 'error');
        return;
    }

    try {
        const response = await fetch('/api/doctor/prescriptions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({
                patient_id: patientId,
                medication,
                dosage,
                frequency,
                duration,
                instructions
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Prescription creation failed');
        }

        showToast('Prescription created successfully', 'success');
        document.getElementById('prescriptionForm').reset();
        bootstrap.Modal.getInstance(document.getElementById('prescriptionModal')).hide();
        loadDashboardData(); // Refresh data
    } catch (error) {
        console.error('Prescription error:', error);
        showToast(error.message || 'Failed to create prescription', 'error');
    }
});

// Helper functions
function mapFhirStatus(fhirStatus) {
    const statusMap = {
        'proposed': 'Pending',
        'booked': 'Confirmed',
        'fulfilled': 'Completed',
        'cancelled': 'Cancelled'
    };
    return statusMap[fhirStatus] || fhirStatus;
}

function getStatusBadgeClass(status) {
    switch (status.toLowerCase()) {
        case 'confirmed': return 'bg-success';
        case 'pending': return 'bg-warning text-dark';
        case 'cancelled': return 'bg-danger';
        default: return 'bg-secondary';
    }
}

function getParticipantName(participants, resourceType) {
    const participant = participants.find(p =>
        p.actor.reference.startsWith(resourceType)
    );
    return participant?.actor.display || '';
}

function showToast(message, type = 'success') {
    // Implement toast notification
    alert(`${type.toUpperCase()}: ${message}`);
}

document.addEventListener('DOMContentLoaded', initializeApp);

