// prescriptions.js
let currentUser = null;

async function verifyAuthentication() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            throw new Error('No authentication token found');
        }

        currentUser = JSON.parse(atob(token.split('.')[1]));

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

async function initializePrescriptions() {
    try {
        const auth = await verifyAuthentication();
        if (!auth) return;

        await loadPrescriptions();
        setupEventListeners();
    } catch (error) {
        console.error('Prescriptions initialization failed:', error);
        clearAuthData();
        window.location.href = '/login';
    }
}

async function loadPrescriptions() {
    try {
        showLoading(true);
        const response = await fetch('/api/doctor/prescriptions', {
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
            throw new Error(`Failed to load prescriptions: ${response.status}`);
        }

        const prescriptions = await response.json();
        renderPrescriptions(prescriptions);
    } catch (error) {
        console.error('Error loading prescriptions:', error);
        showToast(error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function renderPrescriptions(prescriptions) {
    const container = document.getElementById('prescriptionsContainer');
    if (!container) return;

    container.innerHTML = '';

    if (prescriptions.length === 0) {
        container.innerHTML = `
            <div class="alert alert-info">
                No prescriptions found
            </div>
        `;
        return;
    }

    const table = document.createElement('table');
    table.className = 'table table-hover';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Medication</th>
                <th>Dosage</th>
                <th>Status</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody id="prescriptionsList"></tbody>
    `;

    container.appendChild(table);
    const tbody = document.getElementById('prescriptionsList');

    prescriptions.forEach(prescription => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(prescription.prescription_date)}</td>
            <td>${prescription.patient_name}</td>
            <td>${prescription.medication}</td>
            <td>${prescription.dosage}</td>
            <td>
                <span class="badge ${prescription.is_active ? 'bg-success' : 'bg-secondary'}">
                    ${prescription.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary download-btn me-2" 
                    data-prescription-id="${prescription.id}">
                    <i class="bi bi-download"></i> Download
                </button>
                <button class="btn btn-sm btn-outline-danger deactivate-btn" 
                    data-prescription-id="${prescription.id}"
                    ${!prescription.is_active ? 'disabled' : ''}>
                    <i class="bi bi-x-circle"></i> Deactivate
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}


function setupEventListeners() {
    // Download button
    document.addEventListener('click', async function (e) {
        if (e.target.closest('.download-btn')) {
            const btn = e.target.closest('.download-btn');
            const prescriptionId = btn.getAttribute('data-prescription-id');
            await downloadPrescription(prescriptionId);
        }

        if (e.target.closest('.deactivate-btn')) {
            const btn = e.target.closest('.deactivate-btn');
            const prescriptionId = btn.getAttribute('data-prescription-id');
            await deactivatePrescription(prescriptionId);
        }

        if (e.target.closest('#newPrescriptionBtn')) {
            document.getElementById('prescriptionModal').querySelector('.modal-title')
                .textContent = 'Create New Prescription';
            document.getElementById('patientId').value = '';
            new bootstrap.Modal(document.getElementById('prescriptionModal')).show();
        }
    });

    // Prescription form submission
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
            await loadPrescriptions();
        } catch (error) {
            console.error('Prescription error:', error);
            showToast(error.message || 'Failed to create prescription', 'error');
        }
    });
}
async function downloadPrescription(prescriptionId) {
    try {
        const response = await fetch(`/api/doctor/prescriptions/${prescriptionId}/download`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to download prescription');
        }

        // Create blob from response
        const blob = await response.blob();

        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `prescription_${prescriptionId}.pdf`;
        document.body.appendChild(a);
        a.click();

        // Clean up
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);

        showToast('Prescription downloaded successfully', 'success');
    } catch (error) {
        console.error('Download error:', error);
        showToast(error.message || 'Failed to download prescription', 'error');
    }
}

async function deactivatePrescription(prescriptionId) {
    if (!confirm('Are you sure you want to deactivate this prescription?')) return;

    try {
        const response = await fetch(`/api/doctor/prescriptions/${prescriptionId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ is_active: false })
        });

        if (!response.ok) {
            throw new Error('Failed to update prescription status');
        }

        showToast('Prescription deactivated successfully', 'success');
        await loadPrescriptions();
    } catch (error) {
        console.error('Deactivation error:', error);
        showToast(error.message || 'Failed to deactivate prescription', 'error');
    }
}


function showLoading(show) {
    const loader = document.getElementById('loadingIndicator');
    if (loader) {
        loader.style.display = show ? 'block' : 'none';
    }
}

function showToast(message, type = 'success') {
    // Implement your toast notification here
    alert(`${type.toUpperCase()}: ${message}`);
}

document.addEventListener('DOMContentLoaded', initializePrescriptions);