const fhirUtils = require('../utils/fhirUtils');

module.exports = function errorHandler(err, req, res, next) {
    console.error('Server error:', err.stack);
    res.status(500).json(
        fhirUtils.createOperationOutcome("error", "server-error", "Something went wrong!")
    );
};
