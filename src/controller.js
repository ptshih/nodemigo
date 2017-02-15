import _ from 'lodash';
import xml2js from 'xml2js';

// Escape special characters in regex string
function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

export default class Controller {
  constructor({ app, db, wss }) {
    this.app = app;
    this.db = db;
    this.wss = wss;

    // Controller defined routes
    this.routes = [];

    // Controller defined middleware
    this.pre = []; // run before route middleware
    this.before = []; // run after route middleware but before route handler
    this.after = []; // run after route handler

    // Internal middleware
    this._begin = [];
    this._end = [
      this.successResponse,
      this.errorResponse,
      this.finalResponse,
    ];

    // Support optional XML response format
    this.xmlBuilder = new xml2js.Builder({
      renderOpts: {
        pretty: false,
      },
    });
  }

  throwError(message, status = 500) {
    const err = new Error(message);
    err.status = status;
    throw err;
  }

  addRoutes(routes) {
    this.routes = [...this.routes, ...routes];
  }

  /* Middleware */

  // TODO: Parse created_at/updated_at bounding

  parseFields(req) {
    const fields = req.query.fields || req.query.attributes;
    if (!_.isString(fields)) {
      return [];
    }

    return fields.replace(/\s+/g, '').split(',');
  }

  parsePagination(req) {
    let offset = _.parseInt(req.query.offset || req.query.skip) || 0;
    const limit = _.parseInt(req.query.limit || req.query.count) || 0;

    // Support using `page` instead of `offset`
    const page = _.parseInt(req.query.page) || 0;
    if (page > 0) {
      // IMPORTANT! `page` starts at 1
      // if `page` is specified, we override `offset`
      // calculate offset based on page and limit
      // lets assume limit is 100
      // page 1 is offset 0
      // page 2 is offset 100
      // etc...
      offset = (page - 1) * limit;
    }

    return {
      offset,
      limit,
      page,
    };
  }

  parseOrdering(req) {
    if (!req.query.order || !req.query.direction) {
      return {};
    }

    const order = req.query.order;
    const direction = req.query.direction.toUpperCase();
    if (!['ASC', 'DESC'].includes(direction)) {
      return {};
    }

    return [[order, direction]];
  }

  parseQueryParams(req) {
    if (!this.queryParams) {
      return {};
    }

    const query = {};
    const queries = [];
    const params = _.pick(req.query, _.keys(this.queryParams));
    const logicalOperator = `$${(req.query.logical || 'and').toLowerCase().replace(/[@\s]/g, '')}`;

    _.forEach(params, (val, key) => {
      // If value is `*`, ignore this param
      if (val === '*') {
        return;
      }

      // Make sure val is a string (should usually be from express)
      if (!_.isString(val)) {
        val = val.toString();
      }

      // Support `,` as `$or` for each param
      let vals = val.split(',');

      // No value, ignore this param
      if (vals.length === 0) {
        return;
      }

      // The built query filter
      const filter = {};

      // Get param type defined in `queryParams`
      const type = this.queryParams[key];

      // Deal with different param types
      if (type === 'bool' || type === 'boolean') {
        vals = _.map(vals, (v) => {
          if (v === 'true' || v === 'yes' || v === '1') {
            return true;
          } else if (v === 'false' || v === 'no' || v === '0') {
            return false;
          }

          return false;
        });
      } else if (type === 'string') {
        // strings and objectid
        // no transformation
      } else if (type === 'regex') {
        // regex case insensitive and escaping special characters
        vals = _.map(vals, v => ({
          $regex: escapeRegExp(v),
          $options: 'i',
        }));
      } else if (type === 'integer') {
        // integers
        vals = _.map(vals, v => _.parseInt(v));
      } else if (type === 'float') {
        // floats
        vals = _.map(vals, v => parseFloat(v));
      } else {
        // invalid or unknown type
        return;
      }

      // If there is only one val, no need to use `$or`
      if (vals.length === 1) {
        // Treat `[]` as empty array
        filter[key] = vals[0] === '[]' ? [] : vals[0];
      } else {
        const orExpr = [];
        _.forEach(vals, (orVal) => {
          const orClause = {};
          orClause[key] = orVal;
          orExpr.push(orClause);
        });
        filter.$or = orExpr;
      }

      queries.push(filter);
    });

    // Combine the query
    if (queries.length === 1) {
      _.assign(query, queries[0]);
    } else if (queries.length > 0) {
      query[logicalOperator] = queries;
    }

    return query;
  }

  successResponse(req, res, next) {
    const envelope = {
      meta: {
        statusCode: res.statusCode,
      },
      data: res.data || {},
    };

    // Paging (optional)
    if (_.isPlainObject(res.paging)) {
      envelope.meta.paging = res.paging;
    }

    // Response
    res.envelope = res.statusCode !== 204 ? envelope : undefined;

    next();
  }

  /**
   * Error
   * - statusCode (http status code - number)
   * - type (internal error type - string)
   * - message (human readable - string)
   * - line (stack trace - string)
   */
  errorResponse(err, req, res, next) {
    const error = new Error();

    if (_.isFunction(req.validationErrors) && req.validationErrors().length) {
      // Express Validator
      const messages = req.validationErrors().map(ve => `[${ve.param} -> ${ve.msg}]`);
      error.message = messages.join(', ');
      error.statusCode = 400;
      error.type = 'EXPRESS_VALIDATION_ERROR';
      error.meta = {
        validationErrors: req.validationErrors(),
      };
    } else {
      error.message = err.message || 'Internal Server Error';
      error.statusCode = _.parseInt(err.statusCode) || 500;
    }

    // Pass on any `meta` data from the original error
    error.meta = err.meta || error.meta;

    // Pass on any `data` from the original error
    error.data = err.data || {};

    // Try and extract the line in which the error was caught
    if (err.stack) {
      try {
        error.line = err.stack.split('\n')[1].match(/at\s(.*)/)[1];
      } catch (e) {
        error.line = null;
      }
    }

    let defaultErrorType;
    switch (error.statusCode) {
      case 400:
        defaultErrorType = 'BAD_REQUEST';
        break;
      case 401:
        defaultErrorType = 'UNAUTHORIZED';
        break;
      case 402:
      case 403:
        defaultErrorType = 'FORBIDDEN';
        break;
      case 404:
        defaultErrorType = 'NOT_FOUND';
        break;
      case 405:
        defaultErrorType = 'METHOD_NOT_ALLOWED';
        break;
      case 406:
        defaultErrorType = 'NOT_ACCEPTABLE';
        break;
      case 409:
        defaultErrorType = 'CONFLICT';
        break;
      case 410:
        defaultErrorType = 'GONE';
        break;
      case 501:
        defaultErrorType = 'NOT_IMPLEMENTED';
        break;
      case 500:
      default:
        defaultErrorType = 'INTERNAL_SERVER_ERROR';
        break;
    }

    const envelope = {
      meta: {
        statusCode: error.statusCode,
        errorType: error.type || defaultErrorType,
        errorMessage: error.message,
      },
      data: error.data,
    };

    // Error Line from Stack (optional)
    if (error.line) {
      envelope.meta.errorLine = error.line;
    }

    // Response
    res.status(error.statusCode);
    res.error = error;
    res.err = error;
    res.envelope = envelope;

    next();
  }

  /**
   * Attempts to respond to the request with data or error
   * Can respond in either `json` or `xml` format
   */
  finalResponse(req, res) {
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
    const xmlBuilder = this.xmlBuilder;
    res.format({
      json() {
        res.jsonp(res.envelope);
      },
      xml() {
        try {
          const xmlData = JSON.parse(JSON.stringify(res.envelope));
          const xml = xmlBuilder.buildObject(xmlData);
          res.set('Content-Type', 'application/xml; charset=utf-8');
          res.send(xml);
        } catch (e) {
          res.status(500).end();
        }
      },
      text() {
        res.send(res.envelope);
      },
      default() {
        res.status(406).send('Not Acceptable');
      },
    });
  }
}
