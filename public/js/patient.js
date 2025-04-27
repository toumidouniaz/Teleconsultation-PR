document.addEventListener('DOMContentLoaded', function () {
    // Load dashboard data
    async function loadDashboardData() {
        const token = localStorage.getItem('authToken');
        console.log('Attempting to load dashboard with token:', token);
        if (!token) {
            console.log('No token found, redirecting to login');
            window.location.href = '/login';
            return;
        }
        try {
            console.log('Verifying token...');
            const verifyResponse = await fetch('/api/auth/verify', {
                headers: { 'Authorization': `Bearer ${token}` },
                credentials: 'include'
            });

            console.log('Verify response status:', verifyResponse.status);

            if (!verifyResponse.ok) {
                const errorData = await verifyResponse.json();
                console.log('Token verification failed:', errorData);
                localStorage.removeItem('authToken');
                window.location.href = '/login';
                return;
            }

            console.log('Loading dashboard data...');
            const dashboardResponse = await fetch('/api/patient/dashboard', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });

            console.log('Dashboard response status:', dashboardResponse.status);

            if (dashboardResponse.status === 401) {
                const errorData = await dashboardResponse.json();
                console.log('Dashboard access denied:', errorData);
                localStorage.removeItem('authToken');
                window.location.href = '/login';
                return;
            }

            if (!dashboardResponse.ok) {
                throw new Error(`Dashboard request failed: ${dashboardResponse.status}`);
            }

            const data = await dashboardResponse.json();
            console.log('Dashboard data received:', data);
            loadAppointments(data.appointments || []);
            loadPrescriptions(data.prescriptions || []);
            loadDoctors(data.availableDoctors || []);
        } catch (error) {
            console.error('Dashboard load error:', error);
            showToast(error.message, 'error');
            localStorage.removeItem('authToken');
            window.location.href = '/login';
        }
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
            card.className = 'card mb-3';
            card.innerHTML = `
                <div class="card-body">
                    <h5 class="card-title">${pres.medication}</h5>
                    <h6 class="card-subtitle mb-2 text-muted">
                        Prescribed on ${formatDate(pres.date)} by Dr. ${pres.doctor}
                    </h6>
                    <p class="card-text">
                        <strong>Dosage:</strong> ${pres.dosage}<br>
                        <strong>Instructions:</strong> ${pres.instructions}
                    </p>
                </div>
            `;
            container.appendChild(card);
        });
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

    // Initialize
    loadDashboardData();
});