const uuid = require('uuid');

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
                },
                identifier: [{
                    system: 'urn:ietf:rfc:3986',
                    value: doctorData.license_number
                }]
            }]
        };
    },

    createAppointmentResource: (appointmentData) => {
        return {
            resourceType: 'Appointment',
            id: appointmentData.fhir_id,
            status: appointmentData.fhir_status,
            serviceType: [{
                coding: [{
                    system: 'http://snomed.info/sct',
                    code: '394801000',
                    display: appointmentData.reason || 'General medical consultation'
                }]
            }],
            start: new Date(`${appointmentData.appointment_date}T${appointmentData.appointment_time}:00Z`).toISOString(),
            end: new Date(new Date(`${appointmentData.appointment_date}T${appointmentData.appointment_time}:00Z`).getTime() + 30 * 60000).toISOString(),
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

    createMedicationRequestResource: (prescriptionData) => {
        return {
            resourceType: 'MedicationRequest',
            id: prescriptionData.fhir_id,
            status: prescriptionData.fhir_status,
            intent: 'order',
            medicationCodeableConcept: {
                text: prescriptionData.medication
            },
            subject: {
                reference: `Patient/${prescriptionData.patient_fhir_id}`,
                display: prescriptionData.patient_name
            },
            authoredOn: prescriptionData.prescription_date,
            requester: {
                reference: `Practitioner/${prescriptionData.doctor_fhir_id}`,
                display: prescriptionData.doctor_name
            },
            dosageInstruction: [{
                text: `Take ${prescriptionData.dosage}${prescriptionData.instructions ? ' ' + prescriptionData.instructions : ''}`
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
    }
};