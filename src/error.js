module.exports = class ApiError extends Error {
  constructor(message, statusCode) {
    // Calling parent constructor of base Error class.
    super(message);

    // Saving class name in the property of our custom error as a shortcut.
    this.name = this.constructor.name;
    this.message = message;
    this.statusCode = statusCode || 500;

    // Capturing stack trace, excluding constructor call from it.
    Error.captureStackTrace(this, this.constructor);
  }
};
