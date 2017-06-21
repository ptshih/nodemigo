module.exports = class ApiError extends Error {
  constructor(message, { statusCode, meta, data }) {
    super(message);

    this.name = 'ApiError';
    this.message = message;
    this.statusCode = statusCode || 500;
    this.meta = meta;
    this.data = data;

    Error.captureStackTrace(this, ApiError);
  }
};
