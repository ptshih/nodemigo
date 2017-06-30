module.exports = class ApiError extends Error {
  constructor(message, { statusCode = 500, meta = {}, data = {} }) {
    super(message);

    this.name = 'ApiError';
    this.message = message;
    this.statusCode = statusCode;
    this.meta = meta;
    this.data = data;

    Error.captureStackTrace(this, ApiError);
  }
};
