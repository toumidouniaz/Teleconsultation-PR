window.showToast = showToast;

// Initialize the appointments page
function initializeAppointmentsPage() {
    // Load appointments data
    loadDoctorAppointments();

    // Setup filter event listeners
    document.getElementById('statusFilter').addEventListener('change', function (e) {
        e.preventDefault();
        loadDoctorAppointments();
    });

    document.getElementById('dateFilter').addEventListener('change', function (e) {
        e.preventDefault();
        const showCustom = this.value === 'custom';
        document.getElementById('startDateContainer').style.display = showCustom ? 'block' : 'none';
        document.getElementById('endDateContainer').style.display = showCustom ? 'block' : 'none';
        if (!showCustom) loadDoctorAppointments();
    });

    document.getElementById('startDate').addEventListener('change', function (e) {
        e.preventDefault();
        loadDoctorAppointments();
    });

    document.getElementById('endDate').addEventListener('change', function (e) {
        e.preventDefault();
        loadDoctorAppointments();
    });

    // Add apply filters button listener
    document.getElementById('applyFiltersBtn').addEventListener('click', function (e) {
        e.preventDefault();
        loadDoctorAppointments();
    });
}

// Load doctor appointments with filters
async function loadDoctorAppointments(page = 1) {
    try {
        showLoading(true);
        const statusFilter = document.getElementById('statusFilter').value;
        const dateFilter = document.getElementById('dateFilter').value;
        let startDate = '', endDate = '';

        if (dateFilter === 'custom') {
            startDate = document.getElementById('startDate').value;
            endDate = document.getElementById('endDate').value;
        }

        const response = await fetch(`/api/doctor/appointments?status=${statusFilter}&date=${dateFilter}&start=${startDate}&end=${endDate}&page=${page}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Failed to load appointments');

        const data = await response.json();
        renderDoctorAppointments(data);
    } catch (error) {
        console.error('Error loading appointments:', error);
        showToast(error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Render appointments data
function renderDoctorAppointments(data) {
    const upcomingContainer = document.getElementById('upcomingAppointments');
    const historyContainer = document.getElementById('appointmentHistory');
    const paginationContainer = document.getElementById('historyPagination');

    document.getElementById('upcomingCount').textContent = data.upcoming?.length || 0;
    document.getElementById('historyCount').textContent = data.history?.length || 0;
    // Render upcoming appointments
    if (data.upcoming && data.upcoming.length > 0) {
        upcomingContainer.innerHTML = data.upcoming.map(appt => {
            // Ensure status has a default value if undefined
            const status = appt.status || 'unknown';
            return `
            <tr>
                <td>${formatDate(appt.appointment_date)} at ${formatTime(appt.appointment_time)}</td>
                <td>${appt.patient_name}</td>
                <td>${appt.patient_age}</td>
                <td>${appt.reason || 'General Consultation'}</td>
                <td><span class="badge ${getStatusBadgeClass(status)}">${status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-primary view-btn" data-id="${appt.id}">
                        <i class="bi bi-eye"></i> View
                    </button>
                    ${status === 'confirmed' ? `
                    <button class="btn btn-sm btn-success start-btn" data-id="${appt.id}">
                        <i class="bi bi-camera-video"></i> Start
                    </button>
                    ` : ''}
                    ${status === 'pending' ? `
                    <button class="btn btn-sm btn-outline-success accept-btn" data-id="${appt.id}">
                        Accept
                    </button>
                    <button class="btn btn-sm btn-outline-danger reject-btn" data-id="${appt.id}">
                        Reject
                    </button>
                    ` : ''}
                </td>
            </tr>
            `;
        }).join('');

        // Add event listeners for upcoming appointments
        addAppointmentEventListeners();
    } else {
        upcomingContainer.innerHTML = '<tr><td colspan="6" class="text-center">No upcoming appointments found</td></tr>';
    }

    // Render appointment history
    if (data.history && data.history.length > 0) {
        historyContainer.innerHTML = data.history.map(appt => `
            <tr>
                <td>${formatDate(appt.appointment_date)}</td>
                <td>${appt.patient_name}</td>
                <td>${appt.patient_age}</td>
                <td>${appt.reason || 'General Consultation'}</td>
                <td><span class="badge ${getStatusBadgeClass(appt.status)}">${appt.status}</span></td>
                <td>${appt.notes ? appt.notes.substring(0, 30) + (appt.notes.length > 30 ? '...' : '') : '-'}</td>
            </tr>
        `).join('');

        // Add click event to view full notes
        document.querySelectorAll('#appointmentHistory tr').forEach(row => {
            row.addEventListener('click', function () {
                const appointmentId = this.querySelector('td:first-child').getAttribute('data-id');
                if (appointmentId) {
                    showAppointmentDetails(appointmentId);
                }
            });
        });

        // Render pagination
        if (data.totalPages > 1) {
            renderPagination(paginationContainer, data.currentPage, data.totalPages);
        } else {
            paginationContainer.innerHTML = '';
        }
    } else {
        historyContainer.innerHTML = '<tr><td colspan="6" class="text-center">No appointment history found</td></tr>';
        paginationContainer.innerHTML = '';
    }
}

// Add event listeners to appointment buttons
function addAppointmentEventListeners() {
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => showAppointmentDetails(btn.getAttribute('data-id')));
    });

    document.querySelectorAll('.start-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const appointmentId = btn.getAttribute('data-id');
            console.log('Start button clicked for appointment:', appointmentId);
            startAppointment(appointmentId);
        });
    });

    document.querySelectorAll('.accept-btn').forEach(btn => {
        btn.addEventListener('click', () => updateAppointmentStatus(btn.getAttribute('data-id'), 'confirmed'));
    });

    document.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', () => updateAppointmentStatus(btn.getAttribute('data-id'), 'cancelled'));
    });
}

// Render pagination controls
function renderPagination(container, currentPage, totalPages) {
    container.innerHTML = '';

    // Previous button
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    prevLi.innerHTML = `<a class="page-link" href="#" aria-label="Previous"><span aria-hidden="true">&laquo;</span></a>`;
    prevLi.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentPage > 1) loadDoctorAppointments(currentPage - 1);
    });
    container.appendChild(prevLi);

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        const li = document.createElement('li');
        li.className = `page-item ${i === currentPage ? 'active' : ''}`;
        li.innerHTML = `<a class="page-link" href="#">${i}</a>`;
        li.addEventListener('click', (e) => {
            e.preventDefault();
            loadDoctorAppointments(i);
        });
        container.appendChild(li);
    }

    // Next button
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    nextLi.innerHTML = `<a class="page-link" href="#" aria-label="Next"><span aria-hidden="true">&raquo;</span></a>`;
    nextLi.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentPage < totalPages) loadDoctorAppointments(currentPage + 1);
    });
    container.appendChild(nextLi);
}

// Show appointment details
async function showAppointmentDetails(appointmentId) {
    try {
        showLoading(true);
        const response = await fetch(`/api/doctor/appointments/${appointmentId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Failed to load appointment details');

        const appointment = await response.json();
        renderAppointmentDetailsModal(appointment);
    } catch (error) {
        console.error('Error loading appointment details:', error);
        showToast(error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Render appointment details in modal
function renderAppointmentDetailsModal(appointment) {
    const modalContent = document.getElementById('appointmentDetailsContent');

    modalContent.innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <h5>Patient Information</h5>
                <p><strong>Name:</strong> ${appointment.patient_name}</p>
                <p><strong>Age:</strong> ${appointment.patient_age}</p>
                <p><strong>Gender:</strong> ${appointment.patient_gender || 'Not specified'}</p>
            </div>
            <div class="col-md-6">
                <h5>Appointment Details</h5>
                <p><strong>Date:</strong> ${formatDate(appointment.appointment_date)}</p>
                <p><strong>Time:</strong> ${formatTime(appointment.appointment_time)} - ${formatTime(appointment.end_time)}</p>
                <p><strong>Duration:</strong> ${appointment.duration_minutes || 30} minutes</p>
                <p><strong>Status:</strong> <span class="badge ${getStatusBadgeClass(appointment.status)}">${appointment.status}</span></p>
                <p><strong>Reason:</strong> ${appointment.reason || 'General Consultation'}</p>
            </div>
        </div>
        <div class="mt-3">
            <h5>Notes</h5>
            <div class="mb-3">
                <textarea class="form-control" id="appointmentNotes" rows="3">${appointment.notes || ''}</textarea>
            </div>
            <button class="btn btn-success" id="saveNotesBtn" data-id="${appointment.id}">
                Save Notes
            </button>
        </div>
    `;

    // Add event listener for saving notes
    document.getElementById('saveNotesBtn').addEventListener('click', () => {
        saveAppointmentNotes(appointment.id, document.getElementById('appointmentNotes').value);
    });

    const modal = new bootstrap.Modal(document.getElementById('appointmentDetailsModal'));
    modal.show();
}

// Save appointment notes
async function saveAppointmentNotes(appointmentId, notes) {
    try {
        const response = await fetch(`/api/doctor/appointments/${appointmentId}/notes`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ notes })
        });

        if (!response.ok) throw new Error('Failed to save notes');

        showToast('Notes saved successfully', 'success');
        loadDoctorAppointments(); // Refresh the appointments
    } catch (error) {
        console.error(error);
        showToast('Failed to save notes', 'error');
    }
}

// Start an appointment
function startAppointment(appointmentId) {
    console.log('Starting appointment:', appointmentId);
    window.location.href = `/consultation?appointmentId=${appointmentId}&testMode=false`;
}

// Update appointment status
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
        loadDoctorAppointments(); // Refresh the appointments
    } catch (error) {
        console.error(error);
        showToast(`Failed to ${status} appointment`, 'error');
    }
}

// Helper functions
function formatTime(timeStr) {
    if (!timeStr) return '';
    const time = new Date(`2000-01-01T${timeStr}`);
    return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateStr).toLocaleDateString(undefined, options);
}
function showToast(message, type = 'success') {
    // Implement toast notification
    alert(`${type.toUpperCase()}: ${message}`);
}

function getStatusBadgeClass(status) {
    switch ((status || '').toLowerCase()) {
        case 'confirmed': return 'bg-success';
        case 'pending': return 'bg-warning text-dark';
        case 'completed': return 'bg-primary';
        case 'cancelled': return 'bg-danger';
        case 'in-progress': return 'bg-info';
        default: return 'bg-secondary';
    }
}

function showLoading(show) {
    const loader = document.getElementById('loadingIndicator');
    if (loader) {
        loader.style.display = show ? 'block' : 'none';
    }
}

// Initialize the page when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeAppointmentsPage);
