let socket = null;
let currentUser = null;
let allAppointments = [];

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
// Initialize the app
document.addEventListener('DOMContentLoaded', async function () {
    try {
        // Verify authentication
        const auth = await verifyAuthentication();
        if (!auth) return;

        // Load appointments
        await loadAppointments();

        // Set up event listeners
        document.getElementById('filterUpcoming').addEventListener('click', () => filterAppointments('upcoming'));
        document.getElementById('filterPast').addEventListener('click', () => filterAppointments('past'));
        document.getElementById('filterAll').addEventListener('click', () => filterAppointments('all'));
        document.getElementById('confirmAppointment').addEventListener('click', bookNewAppointment);
        document.getElementById('printAppointmentBtn').addEventListener('click', printAppointment);

        // Load doctors for new appointment modal
        await loadDoctorsForAppointment();
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Failed to initialize page', 'error');
    }
});

// Load all appointments
async function loadAppointments(filter = 'upcoming') {
    try {
        const response = await fetch(`/api/patient/appointments?filter=${filter}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Failed to load appointments');

        const data = await response.json();
        allAppointments = data;
        // Use data.appointments instead of just data
        renderAppointments(data.appointments || [], filter);
    } catch (error) {
        console.error('Error loading appointments:', error);
        showToast('Failed to load appointments', 'error');
    }
}

// Render appointments
function renderAppointments(appointments, filter) {
    const tableBody = document.getElementById('appointmentsTable');
    tableBody.innerHTML = '';

    if (appointments.length === 0) {
        tableBody.innerHTML = `
        <tr>
            <td colspan="6">
                <div class="empty-state py-4">
                    <i class="bi bi-calendar-x"></i>
                    <h5>No ${filter} appointments found</h5>
                    <p>You don't have any ${filter} appointments right now.</p>
                    <button class="btn btn-primary" id="bookAppointmentBtn">
                        <i class="bi bi-plus-circle"></i> Book Appointment
                    </button>
                </div>
            </td>
        </tr>
        `;
        return;
    }

    appointments.forEach(appt => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(appt.appointment_date)}</td>
            <td>${formatTime(appt.appointment_time)}</td>
            <td>Dr. ${appt.doctor_name}</td>
            <td>${appt.speciality}</td>
            <td><span class="status-badge ${getStatusBadgeClass(appt.status)}">${appt.status}</span></td>
            <td class="appointment-actions">
                <button class="btn btn-sm btn-outline-primary view-details-btn" data-id="${appt.id}">
                    <i class="bi bi-eye"></i> Details
                </button>
                ${appt.status === 'confirmed' && isToday(appt.appointment_date) ? `
                    <button class="btn btn-sm btn-success join-btn" data-appointment-id="${appt.id}">
                        <i class="bi bi-camera-video"></i> Join
                    </button>
                ` : ''}
                ${appt.status === 'pending' || appt.status === 'confirmed' ? `
                    <button class="btn btn-sm btn-outline-danger cancel-btn" data-appointment-id="${appt.id}">
                        <i class="bi bi-x-circle"></i> Cancel
                    </button>
                ` : ''}
            </td>
        `;
        tableBody.appendChild(row);
    });

    // Add event listeners to all buttons in the table
    addAppointmentEventListeners();
}

// Filter appointments based on selection
// Filter appointments based on selection
function filterAppointments(filterType) {
    const today = new Date().toISOString().split('T')[0];
    let filtered = [];

    switch (filterType) {
        case 'upcoming':
            filtered = (allAppointments.appointments || []).filter(appt =>
                appt.appointment_date >= today &&
                appt.status !== 'cancelled' &&
                appt.status !== 'completed'
            );
            break;
        case 'past':
            filtered = (allAppointments.appointments || []).filter(appt =>
                appt.appointment_date < today ||
                appt.status === 'completed'
            );
            break;
        default:
            filtered = [...(allAppointments.appointments || [])];
    }

    renderAppointments(filtered, filterType);
}

// View appointment details
async function viewAppointmentDetails(appointmentId) {
    try {
        const response = await fetch(`/api/patient/appointments/${appointmentId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Failed to load appointment details');

        const appointment = await response.json();
        showAppointmentDetailsModal(appointment);
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to load appointment details', 'error');
    }
}

// Show appointment details in modal
function showAppointmentDetailsModal(appointment) {
    const modal = new bootstrap.Modal(document.getElementById('appointmentDetailsModal'));
    document.getElementById('appointmentDetailsModalTitle').textContent =
        `Appointment #${appointment.id} - ${formatDate(appointment.appointment_date)}`;

    const statusBadge = `<span class="badge ${getStatusBadgeClass(appointment.status)}">${appointment.status}</span>`;

    document.getElementById('appointmentDetailsModalBody').innerHTML = `
        <div class="row mb-3">
            <div class="col-md-6">
                <h6>Date</h6>
                <p>${formatDate(appointment.appointment_date)}</p>
            </div>
            <div class="col-md-6">
                <h6>Time</h6>
                <p>${formatTime(appointment.appointment_time)} - ${formatTime(appointment.end_time)}</p>
            </div>
        </div>
        <div class="row mb-3">
            <div class="col-md-6">
                <h6>Status</h6>
                <p>${statusBadge}</p>
            </div>
            <div class="col-md-6">
                <h6>Duration</h6>
                <p>${appointment.duration_minutes || 30} minutes</p>
            </div>
        </div>
        <div class="row mb-3">
            <div class="col-md-6">
                <h6>Doctor</h6>
                <p>${appointment.doctor_name}</p>
            </div>
            <div class="col-md-6">
                <h6>Specialty</h6>
                <p>${appointment.speciality}</p>
            </div>
        </div>
        <div class="mb-3">
            <h6>Reason</h6>
            <p>${appointment.reason || 'Not specified'}</p>
        </div>
        ${appointment.notes ? `
        <div class="mb-3">
            <h6>Doctor's Notes</h6>
            <p>${appointment.notes}</p>
        </div>
        ` : ''}
    `;

    // Store current appointment for printing
    document.getElementById('appointmentDetailsModal').dataset.currentAppointment = JSON.stringify(appointment);
    modal.show();
}

// Cancel an appointment
async function cancelAppointment(appointmentId) {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    try {
        const response = await fetch(`/api/patient/appointments/${appointmentId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Cancellation failed');
        }

        showToast('Appointment cancelled successfully', 'success');
        await loadAppointments(); // Refresh the list
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to cancel appointment', 'error');
    }
}

// Load doctors for new appointment form
async function loadDoctorsForAppointment() {
    try {
        const response = await fetch('/api/patient/doctors', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Failed to load doctors');

        const doctors = await response.json();
        const select = document.getElementById('doctorSelect');
        select.innerHTML = '<option value="" selected disabled>Select a doctor</option>';

        doctors.forEach(doctor => {
            const option = document.createElement('option');
            option.value = doctor.id;
            option.textContent = `${doctor.name} (${doctor.speciality})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to load doctors', 'error');
    }
}

// Book a new appointment
async function bookNewAppointment() {
    const doctorId = document.getElementById('doctorSelect').value;
    const date = document.getElementById('appointmentDate').value;
    const time = document.getElementById('appointmentTime').value;
    const reason = document.getElementById('appointmentReason').value;

    if (!doctorId || !date || !time) {
        showToast('Please select a doctor, date, and time', 'error');
        return;
    }

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
                reason: reason
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Booking failed');
        }

        const result = await response.json();
        showToast(`Appointment booked successfully (ID: ${result.appointmentId})`, 'success');

        // Close modal and refresh appointments
        bootstrap.Modal.getInstance(document.getElementById('newAppointmentModal')).hide();
        await loadAppointments();
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to book appointment', 'error');
    }
}

// Print appointment details
function printAppointment() {
    const appointment = JSON.parse(document.getElementById('appointmentDetailsModal').dataset.currentAppointment);

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Appointment #${appointment.id}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #333; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .section { margin-bottom: 20px; }
                    .label { font-weight: bold; }
                    .footer { margin-top: 40px; font-size: 0.8em; text-align: center; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Tele-Med Appointment</h1>
                    <p>${formatDate(appointment.appointment_date)}</p>
                </div>
                
                <div class="section">
                    <h2>Appointment Details</h2>
                    <p><span class="label">ID:</span> ${appointment.id}</p>
                    <p><span class="label">Date:</span> ${formatDate(appointment.appointment_date)}</p>
                    <p><span class="label">Time:</span> ${formatTime(appointment.appointment_time)} - ${formatTime(appointment.end_time)}</p>
                    <p><span class="label">Status:</span> ${appointment.status}</p>
                    <p><span class="label">Reason:</span> ${appointment.reason || 'Not specified'}</p>
                </div>
                
                <div class="section">
                    <h2>Doctor Information</h2>
                    <p><span class="label">Name:</span> ${appointment.doctor_name}</p>
                    <p><span class="label">Specialty:</span> ${appointment.speciality}</p>
                </div>
                
                ${appointment.notes ? `
                <div class="section">
                    <h2>Doctor's Notes</h2>
                    <p>${appointment.notes}</p>
                </div>
                ` : ''}
                
                <div class="footer">
                    <p>Printed from Tele-Med on ${new Date().toLocaleDateString()}</p>
                </div>
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

// Start an appointment (join consultation)
function startAppointment(appointmentId) {
    console.log('Joining consultation for appointment:', appointmentId);
    window.location.href = `/consultation?appointmentId=${appointmentId}&testMode=false`;
}

// Add event listeners to appointment buttons
function addAppointmentEventListeners() {
    document.querySelectorAll('.view-details-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const appointmentId = this.getAttribute('data-id');
            viewAppointmentDetails(appointmentId);
        });
    });

    // Add event listeners to join buttons
    document.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const appointmentId = this.getAttribute('data-appointment-id');
            console.log('Join button clicked for appointment:', appointmentId);
            startAppointment(appointmentId);
        });
    });

    // Add event listeners to cancel buttons
    document.querySelectorAll('.cancel-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const appointmentId = this.getAttribute('data-appointment-id');
            cancelAppointment(appointmentId);
        });
    });
}

// Helper function to check if a date is today
function isToday(dateString) {
    const today = new Date();
    const date = new Date(dateString);
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
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
        case 'completed': return 'bg-primary';
        case 'cancelled': return 'bg-danger';
        case 'noshow': return 'bg-dark';
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
