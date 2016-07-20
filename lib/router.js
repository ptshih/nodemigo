'use strict';

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _express = require('express');

var _express2 = _interopRequireDefault(_express);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Extends `Express.Router` with additional features
 * Controllers can define routes that will be connected here
 *
 * Added Properties:
 *
 * - `routes` an array of connected routes
 *   (all, get, post, put, patch, delete)
 *
 * @param {Object} options
 * @param {Object} controllers An object (map) of controllers: `name -> instance`
 * @return {Router} An instance of `Express.Router`
 */
module.exports = function (options, controllers) {
  // Create a new `Express.Router` with `options`
  // eslint-disable-next-line new-cap
  var router = _express2.default.Router(options || {});

  // Additional properties
  _lodash2.default.assign(router, {
    controllers: controllers || {},
    routes: [],

    /**
     * Iterates over all controllers and connects any routes defined
     */
    addControllerRoutes: function addControllerRoutes() {
      // Used for de-duping
      var paths = {};

      // Each controller has a `routes` object
      // Connect all routes defined in controllers
      _lodash2.default.forEach(router.controllers, function (controller) {
        _lodash2.default.forEach(controller.routes, function (route) {
          // If no route path or action is defined, skip
          if (!_lodash2.default.isString(route.path) || !_lodash2.default.isFunction(route.action)) {
            console.warn('Skipping invalid route...');
            return;
          }

          // Route method defaults to `GET`
          var method = route.method ? route.method.toLowerCase() : 'get';
          var path = route.path.toLowerCase();

          // If path/method has already been defined, skip
          if (paths[path] === method) {
            console.warn('Skipping duplicate route: [%s] %s', method, path);
            return;
          }

          // Setup controller scoped middleware
          // These apply to all routes in the controller
          var pre = _lodash2.default.invokeMap(controller.pre, 'bind', controller) || [];
          var before = _lodash2.default.invokeMap(controller.before, 'bind', controller) || [];
          var after = _lodash2.default.invokeMap(controller.after, 'bind', controller) || [];

          var _begin = _lodash2.default.invokeMap(controller._begin, 'bind', controller) || [];
          var _end = _lodash2.default.invokeMap(controller._end, 'bind', controller) || [];

          // Build the route handler (callback)
          var handler = router._buildHandler(controller, route);

          // Connect the route
          router[method](path, _begin, pre, route.middleware || [], before, handler, after, _end);

          // Add route to set of connected routes
          router.routes.push({
            method: method,
            path: path
          });

          // Use for de-duping
          paths[path] = method;
        });
      });

      // Debug logging
      _lodash2.default.forEach(router.routes, function (route) {
        console.log('├── Route [%s] %s ──┤', route.method, route.path);
      });
    },


    /**
     * Return a route handler/callback
     *
     * @param {Controller} controller
     * @param {Object} route
     * @return {Function}
     */
    _buildHandler: function _buildHandler(controller, route) {
      return function (req, res, next) {
        // Use sanitizer
        var sanitizer = route.sanitizer;
        if (sanitizer) {
          _lodash2.default.forEach(sanitizer, function (defs, field) {
            _lodash2.default.forEach(defs, function (val, key) {
              if (_lodash2.default.isPlainObject(val)) {
                req.sanitize(field)[key].call(req.sanitize(field), val);
              } else if (val === true) {
                req.sanitize(field)[key].call(req.sanitize(field));
              }
            });
          });
        }

        // Use validator
        var validator = route.validator;
        if (validator) {
          req.check(validator);
          if (req.validationErrors().length) {
            return next(new Error('Validation Error.'));
          }
        }

        // Omit disallowed params
        req.blacklist = route.blacklist || [];
        if (req.blacklist.length) {
          req.params = _lodash2.default.omit(req.params, req.blacklist);
          req.query = _lodash2.default.omit(req.query, req.blacklist);
          req.body = _lodash2.default.omit(req.body, req.blacklist);
        }

        // Pick allowed params
        req.whitelist = route.whitelist || [];
        if (req.whitelist.length) {
          req.params = _lodash2.default.pick(req.params, req.whitelist);
          req.query = _lodash2.default.pick(req.query, req.whitelist);
          req.body = _lodash2.default.pick(req.body, req.whitelist);
        }

        // Execute the route for the request
        return route.action.call(controller, req, res, next);
      };
    }
  });

  return router;
};