'use strict';

var debug = require('debug');
var nconf = require('nconf');
var prefix = nconf.get('DEBUG_PREFIX') ? nconf.get('DEBUG_PREFIX') + ':' : '';

module.exports = {
  log: debug(prefix + 'log'),
  info: debug(prefix + 'info'),
  warn: debug(prefix + 'warn'),
  error: debug(prefix + 'error'),
  json: function json(object) {
    var pretty = arguments.length <= 1 || arguments[1] === undefined ? false : arguments[1];

    var json = pretty ? JSON.stringify(object, null, 2) : JSON.stringify(object);
    debug(prefix + 'log').call(debug, json);
  }
};