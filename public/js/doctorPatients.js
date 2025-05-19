let currentPatientId = null;
let currentUser = null;

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

async function initializePatients() {
    try {
        const auth = await verifyAuthentication();
        if (!auth) return;

        currentUser = auth.user;
        await loadPatients();
        setupEventListeners();
    } catch (error) {
        console.error('Initialization failed:', error);
        showToast(error.message || 'Failed to load patients', 'error');
    }
}

async function loadPatients(search = '') {
    try {
        showLoading(true);
        const url = search ? `/api/doctor/patients?search=${encodeURIComponent(search)}` : '/api/doctor/patients';

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Failed to load patients');

        const patients = await response.json();
        renderPatients(patients);
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to load patients', 'error');
    } finally {
        showLoading(false);
    }
}

function renderPatients(patients) {
    const container = document.getElementById('patientsContainer');
    container.innerHTML = '';

    if (patients.length === 0) {
        container.innerHTML = `
            <div class="col-12 text-center py-4">
                <div class="alert alert-info">No patients found</div>
            </div>
        `;
        return;
    }

    patients.forEach(patient => {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4 mb-4';
        col.innerHTML = `
            <div class="card patient-card h-100" data-patient-id="${patient.user_id}">
                <div class="card-body">
                    <h5 class="card-title">${patient.name}</h5>
                    <h6 class="card-subtitle mb-2 text-muted">Age: ${patient.age || 'N/A'}</h6>
                    <p class="card-text">
                        <small class="text-muted">
                            <i class="bi bi-envelope"></i> ${patient.email}<br>
                            <i class="bi bi-telephone"></i> ${patient.phone || 'N/A'}<br>
                            Last visit: ${patient.last_visit ? formatDate(patient.last_visit) : 'Never'}
                        </small>
                    </p>
                </div>
            </div>
        `;
        container.appendChild(col);
    });
}

// Add to your existing code
async function showAssignmentModal() {
    try {
        // Load unassigned patients
        const response = await fetch('/api/doctor/patients/unassigned', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        const patients = await response.json();

        // Create modal content
        const modalBody = document.getElementById('assignmentModalBody');
        modalBody.innerHTML = `
            <div class="mb-3">
                <label class="form-label">Select Patients to Assign</label>
                <div class="list-group" id="unassignedPatientsList">
                    ${patients.map(p => `
                        <label class="list-group-item">
                            <input class="form-check-input me-2" type="checkbox" value="${p.user_id}">
                            ${p.name} (${p.email})
                        </label>
                    `).join('')}
                </div>
            </div>
        `;

        // Show modal
        new bootstrap.Modal(document.getElementById('assignmentModal')).show();
    } catch (error) {
        console.error(error);
        showToast('Failed to load unassigned patients', 'error');
    }
}

async function assignSelectedPatients() {
    const checkboxes = document.querySelectorAll('#unassignedPatientsList input:checked');
    const patientIds = Array.from(checkboxes).map(cb => cb.value);

    if (patientIds.length === 0) {
        showToast('Please select at least one patient', 'error');
        return;
    }

    try {
        const response = await fetch('/api/doctor/patients/assign', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ patientIds })
        });

        if (!response.ok) throw new Error('Assignment failed');

        showToast(`${patientIds.length} patients assigned successfully`, 'success');
        bootstrap.Modal.getInstance(document.getElementById('assignmentModal')).hide();
        loadPatients(); // Refresh the list
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to assign patients', 'error');
    }
}


function setupEventListeners() {
    // Patient card click
    document.addEventListener('click', function (e) {
        const card = e.target.closest('.patient-card');
        if (card) {
            const patientId = card.getAttribute('data-patient-id');
            viewPatientDetails(patientId);
        }
    });

    // Search button
    document.getElementById('searchPatientsBtn').addEventListener('click', function () {
        const query = document.getElementById('patientSearch').value.trim();
        loadPatients(query);
    });

    // Reset search
    document.getElementById('resetSearchBtn').addEventListener('click', function () {
        document.getElementById('patientSearch').value = '';
        loadPatients();
    });

    // Search on Enter
    document.getElementById('patientSearch').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            loadPatients(this.value.trim());
        }
    });

    // Start chat button
    document.getElementById('startChatBtn').addEventListener('click', function () {
        if (currentPatientId) {
            window.location.href = `/doctor/chat?patientId=${currentPatientId}`;
        }
    });

    // Book appointment button
    document.getElementById('bookAppointmentBtn').addEventListener('click', function () {
        if (currentPatientId) {
            openAppointmentModal(currentPatientId);
        }
    });

    document.getElementById('assignPatientsBtn')?.addEventListener('click', showAssignmentModal);
    document.getElementById('confirmAssignmentBtn')?.addEventListener('click', assignSelectedPatients);
}

async function viewPatientDetails(patientId) {
    try {
        currentPatientId = patientId;
        const response = await fetch(`/api/doctor/patients/${patientId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Failed to load patient details');

        const patient = await response.json();
        showPatientModal(patient);
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Failed to load patient details', 'error');
    }
}

function showPatientModal(patient) {
    const modal = new bootstrap.Modal(document.getElementById('patientModal'));

    // Update modal content with the new HTML structure
    document.getElementById('modalPatientName').textContent = patient.name;
    document.getElementById('modalPatientGender').textContent = patient.gender || 'N/A';
    document.getElementById('modalPatientAge').textContent = patient.age || 'N/A';
    document.getElementById('modalPatientPhone').textContent = patient.phone || 'N/A';
    document.getElementById('modalPatientEmail').textContent = patient.email;
    document.getElementById('modalPatientBloodType').textContent = patient.blood_type || 'Unknown';
    document.getElementById('modalPatientAllergies').textContent = patient.allergies || 'None reported';
    document.getElementById('modalPatientLastVisit').textContent = patient.last_visit ? formatDate(patient.last_visit) : 'Never visited';

    // Update notes if available
    if (patient.notes) {
        document.getElementById('modalPatientNotes').textContent = patient.notes;
    }

    modal.show();
}

function openAppointmentModal(patientId) {
    // Reuse your existing appointment modal functionality
    document.getElementById('patientId').value = patientId;
    const modal = new bootstrap.Modal(document.getElementById('appointmentModal'));
    modal.show();
}

// Helper functions
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showLoading(show) {
    document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
}

function showToast(message, type = 'success') {
    // Implement toast notification
    alert(`${type.toUpperCase()}: ${message}`);
}

document.addEventListener('DOMContentLoaded', initializePatients);