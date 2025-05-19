// Add this function to your appointments.js file
function renderAppointments(appointments) {
    const appointmentsContainer = document.getElementById('appointmentsContainer');
    appointmentsContainer.innerHTML = '';
    
    if (appointments.length === 0) {
        appointmentsContainer.innerHTML = '<div class="alert alert-info">No appointments found.</div>';
        return;
    }
    
    appointments.forEach(appointment => {
        const card = document.createElement('div');
        card.className = 'card mb-3';
        
        // Format date and time
        const date = new Date(appointment.appointment_date).toLocaleDateString();
        const time = appointment.appointment_time;
        
        // Determine if the appointment is active (today and within 15 minutes of start time)
        const isToday = new Date(appointment.appointment_date).toDateString() === new Date().toDateString();
        const appointmentTime = new Date(`${appointment.appointment_date}T${appointment.appointment_time}`);
        const now = new Date();
        const timeDiff = Math.abs(appointmentTime - now) / (1000 * 60); // difference in minutes
        
        const canJoin = isToday && timeDiff <= 15 && appointment.status !== 'completed';
        
        card.innerHTML = `
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0">Appointment #${appointment.id}</h5>
                <span class="badge bg-${getStatusBadgeColor(appointment.status)}">${appointment.status}</span>
            </div>
            <div class="card-body">
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Date:</strong> ${date}</p>
                        <p><strong>Time:</strong> ${time}</p>
                        <p><strong>Reason:</strong> ${appointment.reason || 'Not specified'}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>${userRole === 'doctor' ? 'Patient' : 'Doctor'}:</strong> ${userRole === 'doctor' ? appointment.patient_name : appointment.doctor_name}</p>
                        ${userRole === 'patient' ? `<p><strong>Speciality:</strong> ${appointment.speciality || 'General'}</p>` : ''}
                    </div>
                </div>
                <div class="mt-3 d-flex justify-content-end">
                    ${canJoin ? 
                        `<a href="/consultation?appointmentId=${appointment.id}" class="btn btn-success me-2">
                            <i class="bi bi-camera-video-fill me-1"></i> Join Video Consultation
                        </a>` : 
                        ''}
                    <button class="btn btn-outline-secondary" onclick="viewAppointmentDetails(${appointment.id})">
                        View Details
                    </button>
                </div>
            </div>
        `;
        
        appointmentsContainer.appendChild(card);
    });
}

// Helper function to get badge color based on status
function getStatusBadgeColor(status) {
    switch (status) {
        case 'pending': return 'warning';
        case 'confirmed': return 'primary';
        case 'in-progress': return 'info';
        case 'completed': return 'success';
        case 'cancelled': return 'danger';
        default: return 'secondary';
    }
}