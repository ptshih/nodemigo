'use strict';

var _winston = require('winston');

var _winston2 = _interopRequireDefault(_winston);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// TODO: add transports and dynamic log levels

_winston2.default.loggers.add('api', {
  console: {
    level: 'silly',
    colorize: true,
    label: 'api'
  }
});

_winston2.default.loggers.add('app', {
  console: {
    level: 'silly',
    colorize: true,
    label: 'app'
  }
});