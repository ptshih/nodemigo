import _ from 'lodash';
import xml2js from 'xml2js';
import pinoHttp from 'pino-http';

const logger = pinoHttp({
  name: 'router',
  messageKey: 'message',
});

function getOrderDirection(dir) {
  switch (dir) {
    case 'desc':
    case '-1':
      return 'DESC';
    case 'asc':
    case '1':
    default:
      return 'ASC';
  }
}

export default class Controller {
  constructor({ app, db, wss }) {
    this.app = app;
    this.db = db;
    this.wss = wss;

    // Controller defined routes
    this.routes = [];

    // Controller defined middleware (runs immediately before and after route handler)
    this.before = [];
    this.after = [];

    // Internal before/after middleware
    this._before = [];
    this._after = [
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
    let page = _.parseInt(req.query.page) || 0;
    let offset = _.parseInt(req.query.offset || req.query.skip || this.offset) || 0;
    const limit = _.parseInt(req.query.limit || req.query.count || this.limit) || 0;

    if (limit === 0) {
      // no limit, page is always 1
      page = 1;
    } else if (page > 0) {
      // page was specified
      offset = (page - 1) * limit;
    } else if (limit > 0) {
      // limit and offset was specified
      page = _.ceil((offset + 1) / limit);
    } else {
      // default page to 1
      page = 1;
    }

    return {
      page,
      offset,
      limit,
    };
  }

  parseOrdering(req) {
    if (!req.query.order) {
      return [];
    }

    const order = [];
    const pairs = req.query.order.split(',');
    pairs.forEach((pair) => {
      const [key, dir = 'asc'] = pair.split('|');
      order.push([key, getOrderDirection(dir)]);
    });

    return order;
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
      } else if (type === 'like') {
        // SQL LIKE (case insensitive)
        vals = _.map(vals, v => ({
          $iLike: `%${v}%`,
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

  getErrorType(error) {
    if (error.type) {
      return error.type;
    }

    let errorType;
    switch (error.statusCode) {
      case 400:
        errorType = 'BAD_REQUEST';
        break;
      case 401:
        errorType = 'UNAUTHORIZED';
        break;
      case 402:
        errorType = 'PAYMENT_REQUIRED';
        break;
      case 403:
        errorType = 'FORBIDDEN';
        break;
      case 404:
        errorType = 'NOT_FOUND';
        break;
      case 405:
        errorType = 'METHOD_NOT_ALLOWED';
        break;
      case 406:
        errorType = 'NOT_ACCEPTABLE';
        break;
      case 409:
        errorType = 'CONFLICT';
        break;
      case 410:
        errorType = 'GONE';
        break;
      case 412:
        errorType = 'PRECONDITION_FAILED';
        break;
      case 422:
        errorType = 'UNPROCESSABLE_ENTITY';
        break;
      case 429:
        errorType = 'TOO_MANY_REQUESTS';
        break;
      case 500:
        errorType = 'INTERNAL_SERVER_ERROR';
        break;
      case 501:
        errorType = 'NOT_IMPLEMENTED';
        break;
      case 502:
        errorType = 'GATEWAY_ERROR';
        break;
      case 503:
        errorType = 'SERVICE_UNAVAILABLE';
        break;
      default:
        {
          if (error.statusCode >= 400 && error.statusCode < 500) {
            errorType = 'UNKNOWN_CLIENT_ERROR';
          } else if (error.statusCode >= 500) {
            errorType = 'UNKNOWN_SERVER_ERROR';
          } else {
            errorType = 'UNKNOWN_ERROR';
          }
          break;
        }
    }
    return errorType;
  }

  getErrorMessage(error) {
    let msg;
    if (error.message) {
      return error.message;
    }
    if (error.statusCode >= 400 && error.statusCode < 500) {
      msg = 'Client Error';
    } else if (error.statusCode >= 500) {
      msg = 'Internal Server Error';
    } else {
      msg = 'Unknown Error';
    }
    return msg;
  }

  successResponse(req, res, next) {
    const envelope = {
      meta: {
        statusCode: res.statusCode,
      },
      data: res.data || {},
    };

    // Extend meta (optional)
    if (_.isPlainObject(res.meta)) {
      Object.assign(envelope.meta, res.meta);
    }

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
   * - statusCode or status (http status code - number)
   * - type (internal error type - string)
   * - message (human readable - string)
   * - line (stack trace - string)
   */
  errorResponse(err, req, res, next) {
    err.statusCode = _.parseInt(err.statusCode) || _.parseInt(err.status) || 500;
    err.type = this.getErrorType(err);
    err.message = this.getErrorMessage(err);
    err.meta = err.meta || {};
    err.data = err.data || {};

    // Try and extract the line in which the error was caught
    if (err.stack) {
      try {
        err.line = err.stack.split('\n')[1].match(/at\s(.*)/)[1];
      } catch (e) {
        err.line = null;
      }
    }

    const envelope = {
      meta: {
        statusCode: err.statusCode,
        errorType: err.type,
        errorMessage: err.message,
      },
      data: err.data,
    };

    // Error Line from Stack (optional)
    if (err.line) {
      envelope.meta.errorLine = err.line;
    }

    // Response
    res.status(err.statusCode);
    res.error = err;
    res.err = err;
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

    // Logger
    if (res.logger) {
      logger(req, res);
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
