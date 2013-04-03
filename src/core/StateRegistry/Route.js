/*jshint regexp:false*/

/**
 * Route class.
 */
define([
    'dejavu/Class',
    'mout/string/escapeRegExp',
    'mout/object/hasOwn',
    'has'
], function (Class, escapeRegExp, hasOwn, has) {

    'use strict';

    return Class.declare({
        $name: 'Route',

        _name: null,
        _pattern: null,
        _constraints: null,

        _regExp: null,
        _placeholderNames: null,

        /**
         * Constructor.
         *
         * @param {String} name           The name
         * @param {String} pattern        The pattern
         * @param {Object} [$constraints] The constraints to apply to the parameters
         */
        initialize: function (name, pattern, $constraints) {
            if (has('debug') && pattern.charAt(0) !== '/') {
                throw new Error('A route pattern must start with a /.');
            }

            var regExp = escapeRegExp(pattern),
                constraints = $constraints || {},
                x,
                curr,
                tmp;

            this._name = name;
            this._pattern = pattern;
            this._constraints = $constraints;

            // Extract the placeholder names
            this._placeholderNames = regExp.match(this.$static._placeholdersEscapedRegExp);
            if (this._placeholderNames) {
                for (x = this._placeholderNames.length - 1; x >= 0; x -= 1) {
                    curr = this._placeholderNames[x].slice(2, -2);
                    tmp = constraints[curr] ? constraints[curr].toString().slice(1, -1) : '.+?';
                    regExp = regExp.replace(this._placeholderNames[x], '(' + tmp + ')');
                    this._placeholderNames[x] = curr;
                }
            }

            // Create a regexp for this pattern so it can be used to match against
            this._regExp = new RegExp('^' + regExp + '$');
        },

        /**
         * Get the route name.
         *
         * @return {String} The route name
         */
        getName: function () {
            return this._name;
        },

        /**
         * Tests the route against an URL.
         *
         * @param {String} url The URL to check against
         *
         * @return {Boolean} True if it matches, false otherwise
         */
        test: function (url) {
            // Simply test against the generated regexp
            return this._regExp.test(url);
        },

        /**
         * Similar to test but returns an object with all the placeholders filled in.
         * If the URL doesn't match against the route, null is returned.
         *
         * @param {String} url The URL to match against
         *
         * @return {Object} The object containing all the matches, or null if it doesn't match
         */
        match: function (url) {
            var params,
                matches,
                x;

            // Simply match against the generated regexp
            matches = url.match(this._regExp);
            if (matches) {
                params = {};
                for (x = matches.length - 1; x >= 1; x -= 1) {
                    params[this._placeholderNames[x - 1]] = matches[x];
                }
            } else {
                params = null;
            }

            return params;
        },

        /**
         * Generates an URL for this route.
         *
         * @param {Object} [$params] An object containg the route parameters
         *
         * @return {String} The URL
         */
        generateUrl: function ($params) {
            var url = this._pattern,
                constraints = this._constraints || {},
                placeholderName,
                placeholderValue,
                length = this._placeholderNames ? this._placeholderNames.length : 0,
                x;

            if (length) {
                $params = $params || {};

                for (x = 0; x < length; x += 1) {
                    placeholderName = this._placeholderNames[x];

                    // Check if parameter was forgotten
                    if (has('debug') && !hasOwn($params, placeholderName)) {
                        throw new Error('Missing param "' + placeholderName + '".');
                    }

                    // Coerce it into a string
                    placeholderValue = '' + $params[placeholderName];

                    // Validate against the constraints
                    if (has('debug') && constraints[placeholderName] && !constraints[placeholderName].test(placeholderValue)) {
                        throw new Error('Param "' + placeholderName + '" with value "' + placeholderValue + '" does not pass the constraint.');
                    }

                    // Replace it in the URL
                    url = url.replace(this.$static._placeholdersRegExp, placeholderValue);
                }
            }

            return url;
        },

        ////////////////////////////////////////////////////////

        $statics: {
            _placeholdersRegExp: /\{.+?\}/,
            _placeholdersEscapedRegExp: /\\\{.+?\\\}/g
        }
    });
});