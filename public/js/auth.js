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

        // Get all form inputs explicitly
        const formElements = form.elements;
        const data = {
            firstName: formElements.firstName.value.trim(),
            lastName: formElements.lastName.value.trim(),
            email: formElements.email.value.trim(),
            password: formElements.password.value,
            confirmPassword: formElements.confirmPassword.value,
            phone: formElements.phone.value.trim(),
            address: formElements.address.value.trim(),
            // Add other common fields if any
        };

        const isDoctor = window.location.pathname.includes('register_doctor') ||
            new URLSearchParams(window.location.search).get('type') === 'doctor';

        // Add role-specific fields
        if (isDoctor) {
            data.speciality = formElements.speciality.value.trim();
            data.license_number = formElements.license_number.value.trim();
            data.years_of_experience = formElements.years_of_experience.value.trim();
            data.biography = formElements.biography?.value.trim() || '';
        } else {
            data.age = formElements.age.value.trim();
            data.blood_type = formElements.blood_type.value.trim();
            data.height_cm = formElements.height_cm?.value.trim() || '';
            data.weight_kg = formElements.weight_kg?.value.trim() || '';
            data.allergies = formElements.allergies?.value.trim() || '';
            data.birthdate = formElements.birthdate.value.trim();
            // Get the doctor ID from the select2 dropdown
            data.doctorUserId = formElements.doctorUserId?.value || '';
            console.log("Selected doctor ID:", data.doctorUserId); // Debug log
        }

        // Validation - check all required fields
        const requiredFields = ['firstName', 'lastName', 'email', 'password', 'confirmPassword', 'phone', 'address'];
        if (isDoctor) {
            requiredFields.push('speciality', 'license_number', 'years_of_experience');
        } else {
            requiredFields.push('age', 'blood_type', 'birthdate');
        }

        for (const field of requiredFields) {
            if (!data[field]) {
                showError(`Please fill in the ${field.replace('_', ' ')} field`);
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
                return;
            }
        }

        // Check password match
        if (data.password !== data.confirmPassword) {
            showError("Passwords don't match");
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
            return;
        }

        // Check password length
        if (data.password.length < 8) {
            showError("Password must be at least 8 characters");
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
            return;
        }

        // Prepare the request data
        const requestData = {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            password: data.password,
            confirmPassword: data.confirmPassword,
            phone: data.phone,
            address: data.address
        };

        if (isDoctor) {
            requestData.speciality = data.speciality;
            requestData.license_number = data.license_number;
            requestData.years_of_experience = data.years_of_experience;
            requestData.biography = data.biography || '';
        } else {
            requestData.age = data.age;
            requestData.blood_type = data.blood_type;
            requestData.height_cm = data.height_cm || '';
            requestData.weight_kg = data.weight_kg || '';
            requestData.allergies = data.allergies || '';
            requestData.birthdate = data.birthdate;
            // Make sure to include doctorUserId if it exists
            if (data.doctorUserId) {
                requestData.doctorUserId = data.doctorUserId;
            }
        }

        console.log("Request data:", requestData); // Debug log

        const endpoint = isDoctor
            ? '/api/auth/register/doctor'
            : '/api/auth/register/patient';

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
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

// Show/hide other speciality field
document.getElementById('speciality')?.addEventListener('change', function () {
    const otherContainer = document.getElementById('otherSpecialityContainer');
    if (this.value === 'other') {
        otherContainer.style.display = 'block';
        document.getElementById('otherSpeciality').setAttribute('required', 'required');
    } else {
        otherContainer.style.display = 'none';
        document.getElementById('otherSpeciality').removeAttribute('required');
    }
});

// Update form submission to handle the "other" speciality
function registerDoctor(event) {
    event.preventDefault();

    // Get form data
    const form = document.getElementById('doctorRegistrationForm');
    const formData = new FormData(form);

    // Handle "other" speciality
    if (formData.get('speciality') === 'other') {
        formData.set('speciality', formData.get('otherSpeciality'));
    }

    // Convert FormData to object
    const data = {};
    formData.forEach((value, key) => {
        data[key] = value;
    });

    // Continue with registration...
    registerUser(data, true);
}

// Logout function
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

// Verify authentication status on page load
async function verifyAuth() {
    try {
        const token = localStorage.getItem('authToken');

        if (!token) {
            throw new Error('No authentication token found');
        }

        const response = await fetch('/api/auth/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Not authenticated');
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Authentication verification failed:', error);
        return { valid: false };
    }
}

// Check authentication on protected pages
document.addEventListener('DOMContentLoaded', async () => {
    const protectedPages = ['/doctor/dashboard', '/patient/dashboard', '/doctor/appointments',
        '/patient/appointments', '/doctor/prescriptions', '/patient/prescriptions'];

    if (protectedPages.some(page => window.location.pathname.includes(page))) {
        const authStatus = await verifyAuth();

        if (!authStatus.valid) {
            window.location.href = '/login';
            return;
        }

        // Store user data if not already stored
        if (authStatus.valid && authStatus.user) {
            localStorage.setItem('userRole', authStatus.user.role);
            localStorage.setItem('userId', authStatus.user.id);
        }
    }
});

// Initialize Select2 for doctor search with jQuery check
document.addEventListener('DOMContentLoaded', function () {
    // Function to initialize Select2
    function initializeSelect2() {
        if ($('.js-doctor-search').length) {
            $('.js-doctor-search').select2({
                placeholder: 'Search for a doctor',
                allowClear: true,
                minimumInputLength: 2,
                ajax: {
                    url: '/api/auth/doctors/search',
                    dataType: 'json',
                    delay: 250,
                    data: function (params) {
                        return {
                            q: params.term
                        };
                    },
                    processResults: function (data) {
                        return {
                            results: data.doctors.map(function (doctor) {
                                return {
                                    id: doctor.user_id,
                                    text: doctor.name + ' (' + doctor.speciality + ')'
                                };
                            })
                        };
                    },
                    cache: true
                }
            });

            // Log the selected value when it changes (for debugging)
            $('.js-doctor-search').on('change', function () {
                console.log('Selected doctor ID:', $(this).val());
            });
        }
    }

    // Check if jQuery is defined
    if (typeof jQuery !== 'undefined') {
        // jQuery is loaded, initialize Select2
        initializeSelect2();
    } else {
        // jQuery is not loaded, load it dynamically
        const script = document.createElement('script');
        script.src = '/node_modules/jquery/jquery.min.js';
        script.onload = function () {
            // Now load Select2
            const select2Script = document.createElement('script');
            select2Script.src = '/node_modules/select2/js/select2.min.js';
            select2Script.onload = initializeSelect2;
            document.head.appendChild(select2Script);

            // Also load the CSS
            const select2CSS = document.createElement('link');
            select2CSS.rel = 'stylesheet';
            select2CSS.href = '/node_modules/select2/css/select2.min.css';
            document.head.appendChild(select2CSS);
        };
        document.head.appendChild(script);
    }
});
