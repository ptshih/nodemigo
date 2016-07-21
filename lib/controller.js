'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _xml2js = require('xml2js');

var _xml2js2 = _interopRequireDefault(_xml2js);

var _prettyError = require('pretty-error');

var _prettyError2 = _interopRequireDefault(_prettyError);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var pe = new _prettyError2.default();
pe.skipNodeFiles(); // this will skip events.js and http.js and similar core node files
pe.skipPackage('express', 'bluebird');

var Controller = function () {
  function Controller(app, wss) {
    _classCallCheck(this, Controller);

    // Referenecs to the express app and websocketserver connection
    this.app = app;
    this.wss = wss;

    // Mongoose
    this.sort = {};
    this.select = null;

    // Controller defined routes
    this.routes = [];

    // Controller defined middleware
    this.pre = []; // run before route middleware
    this.before = []; // run after route middleware but before route handler
    this.after = []; // run after route handler

    // Internal middleware
    this._begin = [this.parseFields, this.parseSkipLimitSortOrder];
    this._end = [this.successResponse, this.errorResponse, this.finalResponse];

    // Support optional XML response format
    this.xmlBuilder = new _xml2js2.default.Builder({
      renderOpts: {
        pretty: false
      }
    });
  }

  _createClass(Controller, [{
    key: 'throwError',
    value: function throwError(message) {
      var code = arguments.length <= 1 || arguments[1] === undefined ? 500 : arguments[1];

      var err = new Error(message);
      err.code = code;
      throw err;
    }

    /* Middleware */

    // TODO: Parse created_at/updated_at bounding

    /**
     * http://mongoosejs.com/docs/api.html#query_Query-select
     */

  }, {
    key: 'parseFields',
    value: function parseFields(req, res, next) {
      if (_lodash2.default.isString(req.query.fields)) {
        this.select = req.query.fields.replace(/\s+/g, '').replace(/,/g, ' ');
      }

      next();
    }

    /**
     * http://mongoosejs.com/docs/api.html#query_Query-skip
     * http://mongoosejs.com/docs/api.html#query_Query-limit
     * http://mongoosejs.com/docs/api.html#query_Query-sort
     */

  }, {
    key: 'parseSkipLimitSortOrder',
    value: function parseSkipLimitSortOrder(req, res, next) {
      // Skip and Limit
      this.skip = _lodash2.default.parseInt(req.query.skip || req.query.offset) || 0;
      this.limit = _lodash2.default.parseInt(req.query.limit || req.query.count) || 0;

      // Support using `page` instead of `skip`
      this.page = _lodash2.default.parseInt(req.query.page);
      if (this.page > 0) {
        // IMPORTANT! `page` starts at 1
        // if `page` is specified, we override `skip`
        // calculate skip based on page and limit
        // lets assume limit is 100
        // page 1 is skip 0
        // page 2 is skip 100
        // etc...
        this.skip = (this.page - 1) * this.limit;
      }

      // Sort and Sort Order
      if (req.query.sort) {
        var order = void 0;
        switch (req.query.order) {
          case '1':
          case 'asc':
            order = 1;
            break;
          case '-1':
          case 'desc':
            order = -1;
            break;
          default:
            order = 1;
            break;
        }
        this.sort[req.query.sort] = order;
      }

      next();
    }
  }, {
    key: 'successResponse',
    value: function successResponse(req, res, next) {
      var data = res.data || null;
      var code = 200;
      if (_lodash2.default.isNumber(res.code)) {
        code = res.code;
      }
      var envelope = {
        meta: {
          code: code
        },
        data: data
      };

      if (req.mock) {
        envelope.meta.mock = true;
      }

      // Optional paging meta
      if (res.paging) {
        envelope.meta.paging = res.paging;
      }

      // Set code and data
      res.code = code;
      if (res.code !== 204) {
        res.data = envelope;
      }

      next();
    }
  }, {
    key: 'errorResponse',
    value: function errorResponse(err, req, res, next) {
      console.error(pe.render(err));

      // Extract message and code from error
      err.message = err.message || 'Internal Server Error';
      err.code = _lodash2.default.parseInt(err.code) || _lodash2.default.parseInt(res.code) || 500;

      if (_lodash2.default.isFunction(req.validationErrors) && req.validationErrors().length) {
        (function () {
          // All validation errors are code 400
          err.code = 400;

          var errorMessages = [err.message];
          _lodash2.default.each(req.validationErrors(), function (validationError) {
            errorMessages.push('' + validationError.msg);
            err.message = errorMessages.join(' ');
          });
        })();
      }

      // Try and extract the line in which the error was caught
      try {
        err.line = err.stack.split('\n')[1].match(/at\s(.*)/)[1];
      } catch (e) {
        err.line = null;
      }

      var envelope = {
        meta: {
          code: err.code,
          error: {
            code: err.code,
            message: err.message,
            line: err.line
          }
        },
        data: err.message
      };

      // Set code and data
      res.code = err.code;
      res.data = envelope;

      next();
    }
  }, {
    key: 'finalResponse',
    value: function finalResponse(req, res) {
      // If we timed out before managing to respond, don't send the response
      if (res.headersSent) {
        return;
      }

      // Look for `.json` or `.xml` extension in path
      // And override request accept header
      if (/.json$/.test(req.path)) {
        req.headers.accept = 'application/json';
      } else if (/.xml$/.test(req.path)) {
        req.headers.accept = 'application/xml';
      }

      // Use request accept header to determine response content-type
      res.format({
        json: function json() {
          res.status(res.code).jsonp(res.data);
        },
        xml: function xml() {
          try {
            var xmlData = JSON.parse(JSON.stringify(res.data));
            var xml = this.xmlBuilder.buildObject(xmlData);
            res.set('Content-Type', 'application/xml; charset=utf-8');
            res.status(res.code).send(xml);
          } catch (e) {
            res.status(500).end();
          }
        }
      });
    }
  }]);

  return Controller;
}();

exports.default = Controller;