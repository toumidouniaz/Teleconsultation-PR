const uuid = require('uuid');
const moment = require('moment'); // Add moment for date calculations

module.exports = {
    generateFhirId: () => `urn:uuid:${uuid.v4()}`,

    createPatientResource: (patientData) => {
        return {
            resourceType: 'Patient',
            id: patientData.fhir_id,
            identifier: [{
                system: 'urn:ietf:rfc:3986',
                value: patientData.id.toString()
            }],
            name: [{
                family: patientData.last_name,
                given: [patientData.first_name]
            }],
            birthDate: patientData.date_of_birth,
            gender: patientData.gender || 'unknown'
        };
    },

    createPractitionerResource: (doctorData) => {
        return {
            resourceType: 'Practitioner',
            id: doctorData.fhir_id,
            identifier: [{
                system: 'urn:ietf:rfc:3986',
                value: doctorData.id.toString()
            }, {
                system: 'urn:ietf:rfc:3986',
                value: doctorData.license_number
            }],
            name: [{
                family: doctorData.last_name,
                given: [doctorData.first_name]
            }],
            qualification: [{
                code: {
                    coding: [{
                        system: 'http://terminology.hl7.org/CodeSystem/v2-0360',
                        code: 'MD',
                        display: 'Doctor of Medicine'
                    }]
                }
            }]
        };
    },

    createAppointmentResource: (appointmentData) => {
        // Map status to FHIR codes
        const statusMap = {
            'pending': 'proposed',
            'confirmed': 'booked',
            'completed': 'fulfilled',
            'cancelled': 'cancelled',
            'noshow': 'noshow'
        };

        return {
            resourceType: 'Appointment',
            id: appointmentData.fhir_id,
            status: statusMap[appointmentData.status.toLowerCase()] || 'proposed',
            serviceType: [{
                coding: [{
                    system: 'http://snomed.info/sct',
                    code: '394801000',
                    display: appointmentData.reason || 'General medical consultation'
                }]
            }],
            start: new Date(`${appointmentData.appointment_date}T${appointmentData.appointment_time}:00Z`).toISOString(),
            end: new Date(new Date(`${appointmentData.appointment_date}T${appointmentData.appointment_time}:00Z`).getTime() + (appointmentData.duration_minutes || 30) * 60000).toISOString(),
            participant: [
                {
                    actor: {
                        reference: `Patient/${appointmentData.patient_fhir_id}`,
                        display: appointmentData.patient_name
                    },
                    status: 'accepted'
                },
                {
                    actor: {
                        reference: `Practitioner/${appointmentData.doctor_fhir_id}`,
                        display: appointmentData.doctor_name
                    },
                    status: 'accepted'
                }
            ]
        };
    },

    createMedicationRequestResource: function (prescription) {
        return {
            resourceType: "MedicationRequest",
            id: prescription.fhir_id,
            status: prescription.is_active ? "active" : "stopped",
            intent: "order",
            medicationCodeableConcept: {
                text: prescription.medication
            },
            subject: {
                reference: `Patient/${prescription.patient_fhir_id}`
            },
            requester: {
                reference: `Practitioner/${prescription.doctor_fhir_id}`
            },
            dosageInstruction: [{
                text: `${prescription.dosage} ${prescription.frequency} for ${prescription.duration}`,
                timing: {
                    repeat: {
                        frequency: this.parseFrequency(prescription.frequency),
                        periodUnit: "d"
                    }
                },
                doseAndRate: [{
                    doseQuantity: {
                        value: this.parseDosageValue(prescription.dosage),
                        unit: this.parseDosageUnit(prescription.dosage)
                    }
                }]
            }],
            dispenseRequest: {
                validityPeriod: {
                    start: prescription.prescription_date,
                    end: this.calculateEndDate(prescription.prescription_date, prescription.duration)
                }
            },
            note: [{
                text: prescription.instructions
            }]
        };
    },

    createOperationOutcome: (severity, code, details) => {
        return {
            resourceType: 'OperationOutcome',
            issue: [{
                severity,
                code,
                details: { text: details }
            }]
        };
    },

    // Helper functions
    parseFrequency: function (freq) {
        const freqMap = {
            'Once daily': 1,
            'Twice daily': 2,
            'Three times daily': 3,
            'Four times daily': 4,
            'Every 4 hours': 6,
            'Every 6 hours': 4,
            'Every 8 hours': 3,
            'Every 12 hours': 2,
            'As needed': 1
        };
        return freqMap[freq] || 1;
    },

    parseDosageValue: function (dosage) {
        // Extract numeric value from dosage string (e.g., "500mg" -> 500)
        const match = dosage.match(/\d+/);
        return match ? parseFloat(match[0]) : 1;
    },

    parseDosageUnit: function (dosage) {
        // Extract unit from dosage string (e.g., "500mg" -> "mg")
        const match = dosage.match(/\d+\s*(\D+)/);
        return match ? match[1].trim() : 'unit';
    },

    calculateEndDate: function (startDate, duration) {
        if (!duration) return null;

        const durationMap = {
            '1 day': 1,
            '3 days': 3,
            '5 days': 5,
            '7 days': 7,
            '10 days': 10,
            '14 days': 14,
            '21 days': 21,
            '30 days': 30
        };

        const days = durationMap[duration] || 7; // Default to 7 days
        return moment(startDate).add(days, 'days').format('YYYY-MM-DD');
    }
};