const validator = require('fhir-validator');

module.exports = {
    validateResource: (resource) => {
        try {
            const validationResult = validator.validate(resource);
            return {
                valid: validationResult.valid,
                errors: validationResult.errors || []
            };
        } catch (error) {
            console.error('FHIR validation error:', error);
            return {
                valid: false,
                errors: [error.message]
            };
        }
    }
};