import _ from 'lodash';
import express from 'express';
// import onFinished from 'on-finished';
import PrettyError from 'pretty-error';
import uuid from 'uuid';
import ipaddr from 'ipaddr.js';
import responseTime from 'response-time';
import helmet from 'helmet';

// Pretty Error
const pe = new PrettyError();
pe.skipNodeFiles(); // this will skip events.js and http.js and similar core node files
pe.skipPackage('express', 'bluebird', 'lodash');

/**
 * Extends `Express.Router` with additional features
 * Controllers can define routes that will be connected here
 *
 * Added Properties:
 *
 * - `routes` an array of connected routes
 *   (all, get, post, put, patch, delete)
 *
 * @return {Router} An instance of `Express.Router`
 */
export default function Router({ options = {}, controllers = {} }) {
  // Create a new `Express.Router` with `options`
  // eslint-disable-next-line new-cap
  const router = express.Router(options);

  // Alias all PATCH to PUT
  router.patch('*', (req, res, next) => {
    // eslint: no-param-reassign
    req.method = 'PUT';
    next();
  });

  // Attach `db` to all requests
  if (options.db) {
    router.use((req, res, next) => {
      req.db = options.db;
      next();
    });
  }

  // Helmet HTTP headers
  if (options.helmet) {
    router.use(helmet(options.helmet));
  }

  // Set `X-Response-Time` header
  if (options.responseTime) {
    router.use(responseTime(options.responseTime));
  }

  // Assign a UUID to each request
  if (options.id) {
    router.use((req, res, next) => {
      req.id = uuid.v4();
      next();
    });
  }

  if (options.ip) {
    // IP Address (converts ::ffff:127.0.0.1 to 127.0.0.1)
    router.use((req, res, next) => {
      const ipString = req.ip;
      if (ipaddr.IPv4.isValid(ipString)) {
        // ipString is IPv4
        req.ipv4 = req.ip;
      } else if (ipaddr.IPv6.isValid(ipString)) {
        const ip = ipaddr.IPv6.parse(ipString);
        if (ip.isIPv4MappedAddress()) {
          // IP Address (converts ::ffff:127.0.0.1 to 127.0.0.1)
          req.ipv4 = ip.toIPv4Address().toString();
        } else {
          // ipString is IPv6
          req.ipv6 = req.ip;
        }
      } else {
        // NO-OP: ipString is invalid
        req.ipv4 = null;
        req.ipv6 = null;
      }

      next();
    });
  }

  // Additional properties
  _.assign(router, {
    controllers,
    routes: [],

    /**
     * Iterates over all controllers and connects any routes defined
     */
    addControllerRoutes() {
      // Used for de-duping
      const paths = {};

      // Each controller has a `routes` object
      // Connect all routes defined in controllers
      _.forEach(router.controllers, (controller) => {
        _.forEach(controller.routes, (route) => {
          // If no route path or action is defined, skip
          if (!_.isString(route.path) || !_.isFunction(route.action)) {
            // eslint-disable-next-line no-console
            console.warn('Skipping invalid route...');
            return;
          }

          // Route method defaults to `GET`
          const method = route.method ? route.method.toLowerCase() : 'get';
          const path = route.path.toLowerCase();

          // If path/method has already been defined, skip
          if (paths[path] === method) {
            // eslint-disable-next-line no-console
            console.warn('Skipping duplicate route: [%s] %s', method, path);
            return;
          }

          // Setup controller scoped middleware
          // These apply to all routes in the controller
          const before = _.invokeMap(controller.before, 'bind', controller) || [];
          const after = _.invokeMap(controller.after, 'bind', controller) || [];

          const _before = _.invokeMap(controller._before, 'bind', controller) || [];
          const _after = _.invokeMap(controller._after, 'bind', controller) || [];

          // Build the route handler (callback)
          const handler = router._buildHandler(controller, route);

          // Connect the route
          const routeBefore = route.before || route.middleware || []; // route.middleware is DEPRECATED
          const routeAfter = route.after || [];
          router[method](path, _before, routeBefore, before, handler, after, routeAfter, _after);

          // Add route to set of connected routes
          router.routes.push({
            method,
            path,
          });

          // Use for de-duping
          paths[path] = method;
        });
      });
    },

    /**
     * Return a route handler/callback
     *
     * @param {Controller} controller
     * @param {Object} route
     * @return {Function}
     */
    _buildHandler(controller, route) {
      return (req, res, next) => {
        // Use sanitizer
        const sanitizer = route.sanitizer;
        if (sanitizer) {
          _.forEach(sanitizer, (defs, field) => {
            _.forEach(defs, (val, key) => {
              if (_.isPlainObject(val)) {
                req.sanitize(field)[key].call(req.sanitize(field), val);
              } else if (val === true) {
                req.sanitize(field)[key].call(req.sanitize(field));
              }
            });
          });
        }

        // Use validator
        const validator = route.validator;
        if (validator) {
          req.check(validator);
          if (req.validationErrors().length) {
            return next(new Error('Validation Error.'));
          }
        }

        // Omit disallowed params
        req.blacklist = route.blacklist || [];
        if (req.blacklist.length) {
          req.params = _.omit(req.params, req.blacklist);
          req.query = _.omit(req.query, req.blacklist);
          req.body = _.omit(req.body, req.blacklist);
        }

        // Pick allowed params
        req.whitelist = route.whitelist || [];
        if (req.whitelist.length) {
          req.params = _.pick(req.params, req.whitelist);
          req.query = _.pick(req.query, req.whitelist);
          req.body = _.pick(req.body, req.whitelist);
        }

        // Execute the route for the request
        return route.action.call(controller, req, res, next);
      };
    },
  });

  return router;
}
