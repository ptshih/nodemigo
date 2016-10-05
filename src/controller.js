import _ from 'lodash';
import xml2js from 'xml2js';
import PrettyError from 'pretty-error';

const pe = new PrettyError();
pe.skipNodeFiles(); // this will skip events.js and http.js and similar core node files
pe.skipPackage('express', 'bluebird');

// Escape special characters for use in Mongo query
function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

export default class Controller {
  constructor(app, wss) {
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

  throwError(message, code = 500) {
    const err = new Error(message);
    err.code = code;
    throw err;
  }

  /* Middleware */

  // TODO: Parse created_at/updated_at bounding

  /**
   * http://mongoosejs.com/docs/api.html#query_Query-select
   */
  parseFields(req) {
    let select;
    if (_.isString(req.query.fields)) {
      select = req.query.fields.replace(/\s+/g, '').replace(/,/g, ' ');
    }

    return select;
  }

  /**
   * http://mongoosejs.com/docs/api.html#query_Query-skip
   * http://mongoosejs.com/docs/api.html#query_Query-limit
   * http://mongoosejs.com/docs/api.html#query_Query-sort
   */
  parseSkipLimitSortOrder(req) {
    // Skip and Limit
    let skip = _.parseInt(req.query.skip || req.query.offset) || 0;
    const limit = _.parseInt(req.query.limit || req.query.count) || 0;

    // Support using `page` instead of `skip`
    const page = _.parseInt(req.query.page) || 0;
    if (page > 0) {
      // IMPORTANT! `page` starts at 1
      // if `page` is specified, we override `skip`
      // calculate skip based on page and limit
      // lets assume limit is 100
      // page 1 is skip 0
      // page 2 is skip 100
      // etc...
      skip = (page - 1) * limit;
    }

    // Sort and Sort Order
    const sort = {};
    if (req.query.sort) {
      let order;
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
      sort[req.query.sort] = order;
    }

    return {
      skip,
      limit,
      page,
      sort,
    };
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
      // If value is all, ignore this param
      if (val === 'all') {
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
        filter[key] = vals[0];
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

    // console.log('parseQueryParams', query);
    return query;
  }

  successResponse(req, res, next) {
    const data = res.data || null;
    let code = 200;
    if (_.isNumber(res.code)) {
      code = res.code;
    }
    const envelope = {
      meta: {
        code,
      },
      data,
    };

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

  errorResponse(err, req, res, next) {
    console.error(pe.render(err));

    // Extract message and code from error
    err.message = err.message || 'Internal Server Error';
    err.code = _.parseInt(err.code) || _.parseInt(res.code) || 500;

    if (_.isFunction(req.validationErrors) && req.validationErrors().length) {
      // All validation errors are code 400
      err.code = 400;

      const errorMessages = [err.message];
      _.each(req.validationErrors(), (validationError) => {
        errorMessages.push(`${validationError.msg}`);
        err.message = errorMessages.join(' ');
      });
    }

    // Try and extract the line in which the error was caught
    try {
      err.line = err.stack.split('\n')[1].match(/at\s(.*)/)[1];
    } catch (e) {
      err.line = null;
    }

    const envelope = {
      meta: {
        code: err.code,
        error: {
          code: err.code,
          message: err.message,
          line: err.line,
        },
      },
      data: err.message,
    };

    // Set code and data
    res.code = err.code;
    res.data = envelope;

    next();
  }

  /**
   * Attempts to respond to the request with data or error
   * Can respond in either `json` or `xml` format
   * Always calls `next`
   */
  finalResponse(req, res, next) {
    // If we timed out before managing to respond, don't send the response
    if (res.headersSent) {
      next();
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
      json() {
        res.status(res.code).jsonp(res.data);
      },
      xml() {
        try {
          const xmlData = JSON.parse(JSON.stringify(res.data));
          const xml = this.xmlBuilder.buildObject(xmlData);
          res.set('Content-Type', 'application/xml; charset=utf-8');
          res.status(res.code).send(xml);
        } catch (e) {
          res.status(500).end();
        }
      },
      text() {
        res.status(res.code).send(res.data);
      },
      default() {
        res.status(406).send('Not Acceptable');
      },
    });

    next();
  }
}
