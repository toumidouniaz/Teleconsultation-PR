let currentUser = null;

// Central authentication verification
async function verifyAuthentication() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            throw new Error('No authentication token found');
        }

        // Decode token to get user info
        try {
            currentUser = JSON.parse(atob(token.split('.')[1]));
        } catch (e) {
            console.error('Failed to decode token:', e);
            throw new Error('Invalid token format');
        }

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
        window.location.href = '/login?error=' + encodeURIComponent(error.message);
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
        console.log('Initializing doctor dashboard...');

        // 1. Verify authentication
        const auth = await verifyAuthentication();
        if (!auth) return;

        console.log('Authentication verified, loading dashboard data...');

        // 2. Load dashboard data with retry logic
        await loadDashboardDataWithRetry(3); // Retry up to 3 times

        console.log('Dashboard initialized successfully');
    } catch (error) {
        console.error('App initialization failed:', error);
        showToast(`Failed to initialize dashboard: ${error.message}`, 'error');

        // If it's an authentication error, redirect to login
        if (error.message.includes('auth') || error.message.includes('token')) {
            clearAuthData();
            window.location.href = '/login';
        }
    }
}

// Enhanced dashboard loading with retry capability
async function loadDashboardDataWithRetry(maxRetries = 3) {
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            const data = await loadDashboardData();
            return data;
        } catch (error) {
            retryCount++;
            console.error(`Attempt ${retryCount} failed:`, error);

            if (retryCount >= maxRetries) {
                throw error; // Re-throw after last attempt
            }

            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
    }
}

// Dashboard data loading with better error handling
async function loadDashboardData() {
    try {
        console.log('Loading dashboard data...');
        const token = localStorage.getItem('authToken');
        if (!token) throw new Error('No authentication token');

        const response = await fetch('/api/doctor/dashboard', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        console.log('Dashboard response status:', response.status);

        if (response.status === 401) {
            throw new Error('Session expired - please login again');
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Dashboard request failed: ${response.status}`);
        }

        const data = await response.json();
        console.log('Dashboard data received:', data);

        renderDashboard(data);
        return data;
    } catch (error) {
        console.error('Dashboard load error:', error);
        showToast(error.message, 'error');
        throw error; // Re-throw for retry logic
    }
}

// Enhanced renderDashboard function
function renderDashboard(data) {
    try {
        console.log('Rendering dashboard with data:', data);

        // Load all components with error handling
        try {
            loadAppointments(data.todayAppointments || [], data.upcomingAppointments || []);
        } catch (e) {
            console.error('Error loading appointments:', e);
            showToast('Failed to load appointments', 'error');
        }

        try {
            loadPatients(data.recentPatients || []);
        } catch (e) {
            console.error('Error loading patients:', e);
            showToast('Failed to load patients', 'error');
        }

        try {
            loadPendingRequests(data.pendingRequests || []);
        } catch (e) {
            console.error('Error loading pending requests:', e);
            showToast('Failed to load pending requests', 'error');
        }

        try {
            loadQuickStats();
        } catch (e) {
            console.error('Error loading quick stats:', e);
            showToast('Failed to load statistics', 'error');
        }

    } catch (error) {
        console.error('Error rendering dashboard:', error);
        showToast('Failed to render dashboard', 'error');
    }
}

// Improved toast notification
function showToast(message, type = 'error') {
    // Remove any existing toasts
    const existingToasts = document.querySelectorAll('.custom-toast');
    existingToasts.forEach(toast => toast.remove());

    const toast = document.createElement('div');
    toast.className = `custom-toast alert alert-${type === 'error' ? 'danger' : 'success'} position-fixed`;
    toast.style.top = '20px';
    toast.style.right = '20px';
    toast.style.zIndex = '1100';
    toast.style.minWidth = '300px';
    toast.innerHTML = `
        <div class="d-flex justify-content-between">
            <strong>${type === 'error' ? 'Error' : 'Success'}</strong>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
        <div>${message}</div>
    `;

    document.body.appendChild(toast);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        toast.remove();
    }, 5000);
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
    try {
        console.log('Loading appointments...', { todayAppts, upcomingAppts });

        const todaysContainer = document.getElementById('todaysAppointments');
        const upcomingContainer = document.getElementById('upcomingAppointments');

        if (!todaysContainer || !upcomingContainer) {
            throw new Error('Could not find appointment containers in DOM');
        }

        // Clear existing content
        todaysContainer.innerHTML = '';
        upcomingContainer.innerHTML = '';

        // Handle empty states
        if (!todayAppts || todayAppts.length === 0) {
            todaysContainer.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-4">
                        <div class="empty-state">
                            <i class="bi bi-calendar-x"></i>
                            <h5>No appointments today</h5>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            todayAppts.forEach(appt => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${formatTime(appt.time)}</td>
                    <td>${appt.patient}</td>
                    <td>${appt.reason || 'Consultation'}</td>
                    <td><span class="badge ${getStatusBadgeClass(appt.status)}">${appt.status}</span></td>
                    <td>
                        <button class="btn btn-sm btn-success start-btn" data-appointment-id="${appt.id}">
                            <i class="bi bi-play-fill"></i> Start
                        </button>
                    </td>
                `;
                todaysContainer.appendChild(row);
            });
        }

        if (!upcomingAppts || upcomingAppts.length === 0) {
            upcomingContainer.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-4">
                        <div class="empty-state">
                            <i class="bi bi-calendar-x"></i>
                            <h5>No upcoming appointments</h5>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            upcomingAppts.forEach(appt => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>
                        <div class="fw-bold">${formatDate(appt.date)}</div>
                        <div class="text-muted small">${formatTime(appt.time)}</div>
                    </td>
                    <td>${appt.patient}</td>
                    <td>${appt.reason || 'Consultation'}</td>
                    <td>
                        <button class="btn btn-sm btn-success start-btn me-1" data-appointment-id="${appt.id}">
                            <i class="bi bi-play-fill"></i> Start
                        </button>
                        <button class="btn btn-sm btn-outline-danger cancel-btn" data-appointment-id="${appt.id}">
                            <i class="bi bi-x-circle"></i> Cancel
                        </button>
                    </td>
                `;
                upcomingContainer.appendChild(row);
            });
        }

        // Add event listeners
        document.querySelectorAll('.start-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const appointmentId = this.getAttribute('data-appointment-id');
                window.location.href = `/consultation?appointmentId=${appointmentId}`;
            });
        });

        document.querySelectorAll('.cancel-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const appointmentId = this.getAttribute('data-appointment-id');
                if (confirm('Are you sure you want to cancel this appointment?')) {
                    updateAppointmentStatus(appointmentId, 'cancelled');
                }
            });
        });

        console.log('Appointments loaded successfully');
    } catch (error) {
        console.error('Error in loadAppointments:', error);
        showToast('Failed to load appointments. Please try again.', 'error');
        throw error;
    }
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatTime(timeStr) {
    if (!timeStr) return 'N/A';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
}

// Add these new functions to doctor.js:

async function loadQuickStats() {
    try {
        const response = await fetch('/api/doctor/quick-stats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to load quick stats');

        const data = await response.json();

        // Update the UI with quick stats
        document.getElementById('doctorName').textContent = data.doctorName || 'Doctor';
        document.getElementById('todaysAppointmentsCount').textContent = data.todaysAppointments || '0';
        document.getElementById('pendingRequestsCount').textContent = data.pendingRequests || '0';
        document.getElementById('totalPatientsCount').textContent = data.totalPatients || '0';
        document.getElementById('activePrescriptionsCount').textContent = data.activePrescriptions || '0';
        document.getElementById('avgConsultationTime').textContent = data.avgConsultationTime || 'N/A';
    } catch (error) {
        console.error('Error loading quick stats:', error);
    }
}

// Update the appointment status badge to match patient dashboard style
function getStatusBadgeClass(status) {
    switch (status.toLowerCase()) {
        case 'confirmed': return 'status-confirmed';
        case 'pending': return 'status-pending';
        case 'cancelled': return 'status-cancelled';
        case 'completed': return 'status-confirmed';
        default: return 'bg-secondary';
    }
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


// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded, initializing app...');
    initializeApp().catch(error => {
        console.error('Unhandled error during initialization:', error);
        showToast('Failed to initialize application', 'error');
    });
});



