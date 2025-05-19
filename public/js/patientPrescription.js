// patientPrescriptions.js
let currentPage = 1;
const prescriptionsPerPage = 10;
let allPrescriptions = [];

async function verifyAuthentication() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            throw new Error('No authentication token found');
        }

        const response = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: 'include'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Authentication failed');
        }

        return true;
    } catch (error) {
        console.error('Authentication check failed:', error);
        clearAuthData();
        window.location.href = '/login';
        return false;
    }
}

function clearAuthData() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userId');
}

async function loadPrescriptions() {
    try {
        showLoadingState();

        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/patient/prescriptions', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to load prescriptions: ${response.status}`);
        }

        const data = await response.json();
        allPrescriptions = data.prescriptions || [];
        renderPrescriptions();
        setupPagination();
    } catch (error) {
        console.error('Error loading prescriptions:', error);
        showErrorState(error.message);
    }
}

function showLoadingState() {
    const container = document.getElementById('prescriptionsContainer');
    container.innerHTML = `
        <div class="text-center">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p>Loading prescriptions...</p>
        </div>
    `;
}

function showErrorState(message) {
    const container = document.getElementById('prescriptionsContainer');
    container.innerHTML = `
        <div class="alert alert-danger">
            <i class="bi bi-exclamation-triangle-fill"></i> ${message || 'Failed to load prescriptions'}
        </div>
        <button class="btn btn-primary" onclick="loadPrescriptions()">Retry</button>
    `;
}

function renderPrescriptions(filteredPrescriptions = null) {
    const prescriptionsToDisplay = filteredPrescriptions || allPrescriptions;
    const container = document.getElementById('prescriptionsContainer');

    if (prescriptionsToDisplay.length === 0) {
        container.innerHTML = `
            <div class="alert alert-info">
                <i class="bi bi-info-circle-fill"></i> No prescriptions found
            </div>
        `;
        return;
    }

    // Calculate pagination
    const startIndex = (currentPage - 1) * prescriptionsPerPage;
    const endIndex = startIndex + prescriptionsPerPage;
    const paginatedPrescriptions = prescriptionsToDisplay.slice(startIndex, endIndex);

    container.innerHTML = '';

    paginatedPrescriptions.forEach(prescription => {
        const card = document.createElement('div');
        card.className = 'card mb-3 prescription-card';
        card.setAttribute('data-prescription-id', prescription.id);

        const statusBadge = prescription.is_active
            ? '<span class="badge bg-success">Active</span>'
            : '<span class="badge bg-secondary">Inactive</span>';

        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between">
                    <h5 class="card-title">${prescription.medication}</h5>
                    ${statusBadge}
                </div>
                <h6 class="card-subtitle mb-2 text-muted">
                    Prescribed on ${formatDate(prescription.prescription_date)} by Dr. ${prescription.doctor_name}
                </h6>
                <div class="row">
                    <div class="col-md-6">
                        <p class="card-text"><strong>Dosage:</strong> ${prescription.dosage}</p>
                        <p class="card-text"><strong>Frequency:</strong> ${prescription.frequency || 'Not specified'}</p>
                    </div>
                    <div class="col-md-6">
                        <p class="card-text"><strong>Duration:</strong> ${prescription.duration || 'Not specified'}</p>
                        <p class="card-text"><strong>Instructions:</strong> ${prescription.instructions || 'None provided'}</p>
                    </div>
                </div>
                <div class="d-flex justify-content-end mt-2">
                    <button class="btn btn-sm btn-outline-primary view-details-btn" 
                            data-prescription-id="${prescription.id}">
                        <i class="bi bi-eye"></i> View Details
                    </button>
                    <button class="btn btn-sm btn-outline-secondary ms-2 download-pdf-btn" 
                            data-prescription-id="${prescription.id}">
                        <i class="bi bi-download"></i> Download
                    </button>
                </div>
            </div>
        `;

        container.appendChild(card);
    });

    // Add event listeners
    document.querySelectorAll('.view-details-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const prescriptionId = this.getAttribute('data-prescription-id');
            viewPrescriptionDetails(prescriptionId);
        });
    });

    document.querySelectorAll('.download-pdf-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const prescriptionId = this.getAttribute('data-prescription-id');
            downloadPrescriptionPdf(prescriptionId);
        });
    });

    document.querySelectorAll('.prescription-card').forEach(card => {
        card.addEventListener('click', function () {
            const prescriptionId = this.getAttribute('data-prescription-id');
            viewPrescriptionDetails(prescriptionId);
        });
    });
}

function setupPagination() {
    const totalPages = Math.ceil(allPrescriptions.length / prescriptionsPerPage);
    const paginationContainer = document.getElementById('paginationControls');

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    let paginationHTML = `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" aria-label="Previous" id="prevPage">
                <span aria-hidden="true">&laquo;</span>
            </a>
        </li>
    `;

    for (let i = 1; i <= totalPages; i++) {
        paginationHTML += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link page-number" href="#" data-page="${i}">${i}</a>
            </li>
        `;
    }

    paginationHTML += `
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" aria-label="Next" id="nextPage">
                <span aria-hidden="true">&raquo;</span>
            </a>
        </li>
    `;

    paginationContainer.innerHTML = paginationHTML;

    // Add event listeners
    document.getElementById('prevPage')?.addEventListener('click', function (e) {
        e.preventDefault();
        if (currentPage > 1) {
            currentPage--;
            renderPrescriptions();
        }
    });

    document.getElementById('nextPage')?.addEventListener('click', function (e) {
        e.preventDefault();
        const totalPages = Math.ceil(allPrescriptions.length / prescriptionsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderPrescriptions();
        }
    });

    document.querySelectorAll('.page-number').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            currentPage = parseInt(this.getAttribute('data-page'));
            renderPrescriptions();
        });
    });
}

function applyFilters() {
    const dateFilter = document.getElementById('filterDate').value;
    const statusFilter = document.getElementById('filterStatus').value;
    const searchQuery = document.getElementById('searchPrescriptions').value.toLowerCase();

    let filtered = [...allPrescriptions];

    // Apply date filter
    if (dateFilter !== 'all') {
        const now = new Date();
        filtered = filtered.filter(pres => {
            const presDate = new Date(pres.prescription_date);

            switch (dateFilter) {
                case 'this_month':
                    return presDate.getMonth() === now.getMonth() &&
                        presDate.getFullYear() === now.getFullYear();
                case 'last_month':
                    const lastMonth = new Date(now);
                    lastMonth.setMonth(lastMonth.getMonth() - 1);
                    return presDate.getMonth() === lastMonth.getMonth() &&
                        presDate.getFullYear() === lastMonth.getFullYear();
                case 'this_year':
                    return presDate.getFullYear() === now.getFullYear();
                case 'last_year':
                    return presDate.getFullYear() === now.getFullYear() - 1;
                default:
                    return true;
            }
        });
    }

    // Apply status filter
    if (statusFilter !== 'all') {
        filtered = filtered.filter(pres => {
            return statusFilter === 'active' ? pres.is_active : !pres.is_active;
        });
    }

    // Apply search filter
    if (searchQuery) {
        filtered = filtered.filter(pres => {
            return pres.medication.toLowerCase().includes(searchQuery) ||
                (pres.instructions && pres.instructions.toLowerCase().includes(searchQuery));
        });
    }

    currentPage = 1;
    renderPrescriptions(filtered);
}

async function viewPrescriptionDetails(prescriptionId) {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/patient/prescriptions/${prescriptionId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Failed to load prescription details');

        const prescription = await response.json();
        showPrescriptionModal(prescription);
    } catch (error) {
        console.error(error);
        alert(error.message || 'Failed to load prescription details');
    }
}

function showPrescriptionModal(prescription) {
    const modal = new bootstrap.Modal(document.getElementById('prescriptionModal'));
    document.getElementById('prescriptionModalTitle').textContent = `Prescription #${prescription.id}`;

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
                <p>Dr. ${prescription.doctor_name || 'N/A'}</p>
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

async function downloadPrescriptionPdf(prescriptionId) {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/patient/prescriptions/${prescriptionId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Failed to load prescription for download');

        const prescription = await response.json();
        generatePrescriptionPdf(prescription);
    } catch (error) {
        console.error(error);
        alert(error.message || 'Failed to download prescription');
    }
}

function generatePrescriptionPdf(prescription) {
    // Load jsPDF library dynamically
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = function () {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Add prescription details to PDF
        doc.setFontSize(20);
        doc.text('Tele-Med Prescription', 105, 20, { align: 'center' });

        doc.setFontSize(12);
        doc.text(`Prescription #: ${prescription.id}`, 20, 40);
        doc.text(`Date: ${formatDate(prescription.prescription_date)}`, 20, 50);
        doc.text(`Patient: ${prescription.patient_name || 'N/A'}`, 20, 60);

        doc.line(20, 65, 190, 65);

        doc.setFontSize(14);
        doc.text('Medication Details', 20, 75);
        doc.setFontSize(12);
        doc.text(`Medication: ${prescription.medication}`, 20, 85);
        doc.text(`Dosage: ${prescription.dosage}`, 20, 95);
        doc.text(`Frequency: ${prescription.frequency || 'As directed'}`, 20, 105);
        doc.text(`Duration: ${prescription.duration || 'Until finished'}`, 20, 115);
        doc.text(`Instructions: ${prescription.instructions || 'None provided'}`, 20, 125);

        doc.line(20, 180, 190, 180);
        doc.setFontSize(10);
        doc.text(`Prescribed by: Dr. ${prescription.doctor_name || 'N/A'}`, 20, 185);
        doc.text(`License: ${prescription.doctor_license || 'N/A'}`, 20, 190);
        doc.text('Tele-Med Electronic Prescription System', 105, 190, { align: 'center' });

        doc.save(`prescription_${prescription.id}.pdf`);
    };
    document.head.appendChild(script);
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
}

// Initialize the page
document.addEventListener('DOMContentLoaded', async function () {
    const isAuthenticated = await verifyAuthentication();
    if (isAuthenticated) {
        loadPrescriptions();

        // Set up filter event listeners
        document.getElementById('filterDate').addEventListener('change', applyFilters);
        document.getElementById('filterStatus').addEventListener('change', applyFilters);
        document.getElementById('searchPrescriptions').addEventListener('input', applyFilters);
        document.getElementById('clearSearch').addEventListener('click', function () {
            document.getElementById('searchPrescriptions').value = '';
            applyFilters();
        });
        document.getElementById('refreshPrescriptions').addEventListener('click', loadPrescriptions);

        // Set up modal download button
        document.getElementById('downloadPrescriptionPdf')?.addEventListener('click', function () {
            const prescription = JSON.parse(document.getElementById('prescriptionModal').dataset.currentPrescription);
            generatePrescriptionPdf(prescription);
        });
    }
});

function logout() {
    clearAuthData();
    window.location.href = '/login';
}