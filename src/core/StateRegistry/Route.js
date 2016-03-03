/*jshint regexp:false*/

/**
 * Route class.
 */
define([
    'services/address',
    'mout/string/escapeRegExp',
    'mout/object/hasOwn',
    'has'
], function (address, escapeRegExp, hasOwn, has) {

    'use strict';

    /**
     * Constructor.
     *
     * @param {String}   name    The name
     * @param {String}   pattern The pattern
     * @param {Function} [probe] A probe function that asserts if the params are okay
     */
    function Route(name, pattern, probe) {
        if (has('debug') && pattern.charAt(0) !== '/') {
            throw new Error('A route pattern must start with a /.');
        }

        var regExp = pattern.replace(/\//, '\\/'),
            x,
            curr;

        this._name = name;
        this._pattern = pattern;
        this._probe = probe;

        // Extract the placeholder names
        this._placeholderNames = this._pattern.match(this.constructor._placeholdersRegExp) || [];

        for (x = this._placeholderNames.length - 1; x >= 0; x -= 1) {
            curr = this._placeholderNames[x].slice(1, -1);
            regExp = regExp.replace(this._placeholderNames[x], '([^\/]+?)');
            this._placeholderNames[x] = curr;
        }

        // Create a regexp for this pattern so it can be used to match against
        this._regExp = new RegExp('^' + regExp + '$');
    }

    /**
     * Get the route name.
     *
     * @return {String} The route name
     */
    Route.prototype.getName = function () {
        return this._name;
    };

    /**
     * Tries to match this route with the given url.
     * Calls callback with callback(err, params|null).
     *
     * @param {String}   url      The URL to match against
     * @param {Function} callback The callback function
     */
    Route.prototype.match = function (url, callback) {
        var params,
            matches,
            probeRet,
            x;

        // Match against the generated regexp
        matches = url.match(this._regExp);
        if (!matches) {
            return callback();
        }

        // Aggregate the matches
        params = {};
        for (x = matches.length - 1; x >= 1; x -= 1) {
            params[this._placeholderNames[x - 1]] = address.decodeSegment(matches[x]);
        }

        if (!this._probe) {
            return callback(null, params);
        }

        // Probe the params, supporting sync usage
        probeRet = this._probe(params, function (err, ok) {
            callback(err, ok ? params : null);
        });
        probeRet === true && callback(null, params);
    };

    /**
     * Checks if the route satisfies all of the given parameters.
     *
     * @param {Object} params The params object
     *
     * @return {Boolean} True if it satisfies, false otherwise
     */
    Route.prototype.satisfies = function (params) {
        return this._placeholderNames.every(function (name) {
            return params[name] != null;
        });
    };

    /**
     * Generates an URL for this route.
     *
     * @param {Object} [params] An object containing the route parameters
     *
     * @return {String} The URL
     */
    Route.prototype.generateUrl = function (params) {
        var url = this._pattern;

        this._placeholderNames.forEach(function (name) {
            var placeholderValue;

            // Check if parameter was forgotten
            if (has('debug') && !hasOwn(params, name)) {
                throw new Error('Missing param "' + name + '" for route "' + this._name + '".');
            }

            // Coerce it into a string
            placeholderValue = '' + params[name];

            // Replace it in the URL
            url = url.replace(this.constructor._placeholdersRegExpReplace, address.encodeSegment(placeholderValue));
        }, this);

        return url;
    };

    // --------------------------------------------

    Route._placeholdersRegExp = /\{[^\}]+?\}/g;
    Route._placeholdersRegExpReplace = /\{[^\}]+?\}/;

    return Route;
});
