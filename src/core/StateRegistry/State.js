/*jshint eqeqeq:false*/

/**
 * State class.
 */
define([
    'dejavu/Class',
    './StateInterface',
    'amd-utils/lang/isString',
    'amd-utils/lang/isNumber',
    'amd-utils/lang/isBoolean',
    'amd-utils/object/keys',
    'amd-utils/object/values',
    'amd-utils/object/mixIn',
    'has'
], function (Class, StateInterface, isString, isNumber, isBoolean, keys, values, mixIn, has) {

    'use strict';

    var State = Class.declare({
        $name: 'State',
        $implements: StateInterface,

        _name: null,
        _params: null,
        _pos: 0,
        _cursor: 0,

        /**
         * Constructor.
         *
         * @param {String} name      The state name
         * @param {Object} [$params] The state parameters
         */
        initialize: function (name, $params) {
            var key,
                curr;

            if (has('debug') && !name || name.charAt(0) === '.' || name.charAt(0) === '/') {
                throw new Error('State names cannot be empty and cannot start with a dot and a slash.');
            }

            this._name = name;
            if ($params) {
                this._params = $params;

                if (has('debug') && '$state' in this._params) {
                    throw new Error('Param "$state" is reserved.');
                }
                if (has('debug') && '$origin' in this._params) {
                    throw new Error('Param "$origin" is reserved.');
                }

                for (key in $params) {
                    curr = $params[key];

                    if (!has('debug') && isString(curr) && !isNumber(curr) && !isBoolean(curr) && curr != null) {
                        throw new Error('Param "' + key + '" is not an immutable value (only immutable values are allowed - string, number, booleans and nulls).');
                    }
                }
            } else {
                this._params = {};
            }

            this._params.$state = this;
        },

        /**
         * {@inheritDoc}
         */
        getName: function () {
            if (this._pos === -1) {
                return null;
            }

            var branchName = this.getBranchName(),
                dotPos;

            if (branchName == null) {
                return null;
            }

            dotPos = branchName.indexOf('.');

            return dotPos === -1 ? branchName : branchName.substr(0, dotPos);
        },

        /**
         * {@inheritDoc}
         */
        getBranchName: function () {
            return this._pos === -1 ? null : this._name.substr(!this._pos ? this._pos : this._pos + 1);
        },

        /**
         * {@inheritDoc}
         */
        getFullName: function () {
            return this._name;
        },

        /**
         * {@inheritDoc}
         */
        getParams: function () {
            return this._params;
        },

        /**
         * {@inheritDoc}
         */
        next: function () {
            if (this._pos !== -1) {
                this._pos = this._name.indexOf('.', !this._pos ? this._pos : this._pos + 1);
                this._cursor += 1;
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        previous: function () {
            if (this._cursor > 0) {
                this._pos = this._name.substr(0, this._pos === -1 ? this._name.length : this._pos).lastIndexOf('.');
                if (this._pos === -1) {
                    this._pos = 0;
                }
                this._cursor -= 1;
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        getCursor: function () {
            return this._cursor;
        },

        /**
         * {@inheritDoc}
         */
        setCursor: function (cursor) {
            if (cursor > this._cursor) {
                while (cursor > this._cursor) {
                    this.next();
                }
            } else {
                while (cursor < this._cursor) {
                    this.previous();
                }
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        isFullyEqual: function (state) {
            if (this._name !== state._name) {
                return false;
            }

            var selfParams = mixIn({}, this._params),
                otherParams = mixIn({}, state._params);

            delete selfParams.$state;
            delete otherParams.$state;
            delete selfParams.$origin;
            delete otherParams.$origin;

            return this._compareObjects(selfParams, otherParams);
        },

        /**
         * {@inheritDoc}
         */
        isEqual: function (state, $stateNames) {
            var x,
                curr;

            // Compare the name
            if (this.getName() !== state.getName()) {
                return false;
            }

            // Compare the state names if any
            if ($stateNames) {
                for (x = $stateNames.length - 1; x >= 0; x -= 1) {
                    curr = $stateNames[x];
                    if (this._params[curr] != state._params[curr]) {
                        return false;
                    }
                }
            }

            return true;
        },

        /**
         * Compares to objects loosely (not recursively).
         *
         * @return {Boolean} True if they are loosely equal, false otherwise
         */
        _compareObjects: function (obj1, obj2) {
            var keys1 = keys(obj1),
                keys2 = keys(obj2),
                values1,
                values2,
                x;

            if (keys1.length !== keys2.length) {
                return false;
            }

            for (x = keys1.length - 1; x >= 0; x -= 1) {
                if (keys1[x] !== keys2[x]) {
                    return false;
                }
            }

            values1 = values(obj1);
            values2 = values(obj2);

            if (values1.length !== values2.length) {
                return false;
            }

            for (x = values1.length - 1; x >= 0; x -= 1) {
                if (values1[x] != values2[x]) {
                    return false;
                }
            }

            return true;
        }
    });

    return State;
});