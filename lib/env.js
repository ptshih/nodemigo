'use strict';

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _nconf = require('nconf');

var _nconf2 = _interopRequireDefault(_nconf);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var envs = {
  // TELL WEBPACK TO BUILD POSTINSTALL
  BUILD_ASSETS: {
    required: false
  },
  NODE_ENV: {
    required: true,
    export: true
  },
  // DO NOT DEFINE FOR HEROKU
  PORT: {
    required: true,
    export: true,
    type: Number
  },
  URL: {
    required: false,
    export: true
  },
  API_URL: {
    required: false,
    export: true
  },
  API_VHOST: {
    required: false,
    export: true
  },
  DEBUG_PREFIX: {
    required: false
  },

  // UNUSED
  WS_ADDRESS: {
    required: false,
    export: true
  },
  // UNUSED
  CLIENT_TOKEN: {
    required: false
  },
  // UNUSED
  WORKER_TOKEN: {
    required: false
  },

  // MongoDB
  MONGODB_URL: {
    required: false
  },
  MONGODB_USER: {
    required: false
  },
  MONGODB_PASSWORD: {
    required: false
  },

  // Vendor
  STRIPE_SECRET_KEY: {
    required: false
  },
  MAILGUN_KEY: {
    required: false
  },
  GOOGLE_ANALYTICS_ID: {
    required: false,
    export: true
  },
  HEAP_ID: {
    required: false,
    export: true
  }
};

var env = {};
_lodash2.default.each(envs, function (envProps, envName) {
  var envVal = _nconf2.default.get(envName) || '[UNDEFINED]';

  // Required
  if (envProps.required && envVal === '[UNDEFINED]') {
    console.error('├── Missing ENV Variable: ' + envName + '. Check your .env file.');
    process.exit(1);
  }

  // Cast to Number
  if (envProps.type === Number) {
    envVal = Number(envVal);
  }

  // Redacted
  if (envProps.redacted) {
    envVal = '[REDACTED]';
  }

  // Export
  if (envProps.export) {
    env[envName] = envVal;
  }

  console.log('├── ' + envName + '=' + envVal + ' ──┤');
});

module.exports = env;