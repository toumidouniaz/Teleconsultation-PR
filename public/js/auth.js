
// Utility functions
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        setTimeout(() => errorElement.style.display = 'none', 5000);
    }
    console.error(message);
}

function showSuccess(message) {
    const successElement = document.getElementById('successMessage');
    if (successElement) {
        successElement.textContent = message;
        successElement.style.display = 'block';
        setTimeout(() => successElement.style.display = 'none', 5000);
    }
    console.log(message);
}

// Login 

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    console.log('Login form submitted');

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include' // Important for sessions
        });

        console.log('Login response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Login failed');
        }

        const data = await response.json();
        console.log('Login successful, user data:', data.user);

        // Store token and user data
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userRole', data.user.role);
        localStorage.setItem('userId', data.user.id);

        // Wait briefly before redirect
        setTimeout(() => {
            window.location.href = data.redirect ||
                (data.user.role === 'doctor' ? '/doctor/dashboard' : '/patient/dashboard');
        }, 100);

    } catch (error) {
        console.error("Login error:", error);
        showError(error.message || 'Login failed. Please try again.');
    }
});

// Handle registration forms
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log("Registration form submission started");

    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;

    try {
        submitButton.disabled = true;
        submitButton.textContent = 'Processing...';

        // Collect form data
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // Add role-specific fields
        if (window.location.pathname.includes('patient')) {
            data.age = form.querySelector('[name="age"]').value;
        } else if (window.location.pathname.includes('doctor')) {
            data.speciality = form.querySelector('[name="speciality"]').value;
        }

        // --- ADD VALIDATION HERE ---
        const requiredFields = ['firstName', 'lastName', 'email', 'password', 'confirmPassword', 'phone', 'address'];
        if (window.location.pathname.includes('patient')) requiredFields.push('age');
        if (window.location.pathname.includes('doctor')) requiredFields.push('speciality');

        for (const field of requiredFields) {
            if (!data[field] || !data[field].toString().trim()) {
                showError(`Please fill in the ${field} field`);
                return; // Stop submission if any field is missing
            }
        }

        // Check password match
        if (data.password !== data.confirmPassword) {
            showError("Passwords don't match");
            return;
        }

        // Check password length
        if (data.password.length < 8) {
            showError("Password must be at least 8 characters");
            return;
        }

        // Determine endpoint (doctor or patient)
        const isDoctor = window.location.pathname.includes('register_doctor') ||
            new URLSearchParams(window.location.search).get('type') === 'doctor';
        const endpoint = isDoctor
            ? '/api/auth/register/doctor'
            : '/api/auth/register/patient';
        console.log("Registration type:", isDoctor ? "DOCTOR" : "PATIENT");

        // Send data to backend
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        console.log("Registration response:", result);

        if (response.ok) {
            showSuccess('Registration successful! Redirecting to login...');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        } else {
            showError(result.error || 'Registration failed. Please try again.');
        }
    } catch (error) {
        console.error("Registration error:", error);
        showError('An unexpected error occurred. Please try again.');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
    }
});
// Add input validation for password match
document.querySelectorAll('[name="confirmPassword"]').forEach(input => {
    input.addEventListener('input', function () {
        const password = document.querySelector('[name="password"]').value;
        if (this.value !== password) {
            this.setCustomValidity("Passwords don't match");
        } else {
            this.setCustomValidity('');
        }
    });
});

// Add this to auth.js
function logout() {
    // Clear local storage
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userId');

    // Send logout request to server
    fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include' // Important for session cookies
    })
        .then(response => {
            if (response.ok) {
                // Redirect to login page after successful logout
                window.location.href = '/login';
            } else {
                throw new Error('Logout failed');
            }
        })
        .catch(error => {
            console.error('Logout error:', error);
            // Even if server logout fails, clear client-side and redirect
            window.location.href = '/login';
        });
}

// Make the logout function available globally if needed
window.logout = logout;