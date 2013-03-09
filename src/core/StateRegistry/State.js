/*jshint eqeqeq:false*/

/**
 * State class.
 */
define([
    'dejavu/Class',
    './StateInterface',
    'mout/object/keys',
    'mout/object/values',
    'mout/object/mixIn',
    'mout/lang/deepClone',
    'mout/array/remove',
    'has'
], function (Class, StateInterface, keys, values, mixIn, deepClone, remove, has) {

    'use strict';

    var State = Class.declare({
        $name: 'State',
        $implements: StateInterface,

        _name: null,
        _params: null,
        _parts: null,
        _nrParts: 0,
        _cursor: 0,

        /**
         * Constructor.
         * Special parameters can be prefixed with $.
         * Those will not be taken into account in the comparisons.
         *
         * @param {String} name      The state name
         * @param {Object} [$params] The state parameters
         */
        initialize: function (name, $params) {
            this.setFullName(name);
            this.setParams($params);
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
        setFullName: function (name) {
            if (has('debug') && !this.$static.isValid(name)) {
                throw new Error('State name "' + name + '" has an invalid format.');
            }

            this._name = name;
            this._parts = name.split('.');
            this._nrParts = this._parts.length;
            this.setCursor(this._cursor);

            return this;
        },

        /**
         * {@inheritDoc}
         */
        getName: function () {
            return this._cursor < this._nrParts ? this._parts[this._cursor] : null;
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
        setParams: function (params) {
            this._params = params || {};
            this._params.$state = this;

            return this;
        },

        /**
         * {@inheritDoc}
         */
        next: function () {
            if (this._cursor < this._nrParts) {
                this._cursor += 1;
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        previous: function () {
            if (this._cursor > 1) {
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
            if (this._cursor > this._nrParts) {
                this._cursor = this._nrParts;
            } else if (this._cursor < 0) {
                this._cursor = 0;
            } else {
                this._cursor = cursor;
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        isEqual: function (state, $stateParams) {
            var x,
                curr;

            // Strict comparison first
            if (this === state) {
                return true;
            }

            // Compare the name
            if (this.getName() !== state.getName()) {
                return false;
            }

            // Compare the state params if any
            if ($stateParams) {
                for (x = $stateParams.length - 1; x >= 0; x -= 1) {
                    curr = $stateParams[x];
                    if (this._params[curr] != state._params[curr]) {
                        return false;
                    }
                }

                return true;
            }

            // Otherwise compare them all
            return this._compareObjects(this._params, state._params);
        },


        /**
         * {@inheritDoc}
         */
        isFullyEqual: function (state) {
            // Strict comparison first
            if (this === state) {
                return true;
            }

            // Compare the name
            if (this._name !== state._name) {
                return false;
            }

            // Compare all the params
            return this._compareObjects(this._params, state._params);
        },

        /**
         * {@inheritDoc}
         */
        clone: function () {
            var params = {},
                key,
                ret;

            // Construct a clone of the parameters, except the special ones
            for (key in this._params) {
                if (key.charAt(0) !== '$') {
                    params[key] = deepClone(this._params[key]);
                } else {
                    params[key] = this._params[key];
                }
            }

            // Create a new state
            ret = new State(this._name, params);
            ret._cursor = this._cursor;

            return ret;
        },

        /**
         * Compares two objects loosely and not recursively.
         *
         * @return {Boolean} True if they are loosely equal, false otherwise
         */
        _compareObjects: function (obj1, obj2) {
            var keys1 = keys(obj1),
                keys2 = keys(obj2),
                key,
                x;

            // Remove special keys
            for (x = keys1.length - 1; x >= 0; x -= 1) {
                if (keys1[x].charAt(0) === '$') {
                    keys1.splice(x, 1);
                }
            }

            // Compare the objects
            // We first compare the first with the second and then the second with the first
            for (x = keys1.length - 1; x >= 0; x -= 1) {
                key = keys1[x];

                if (obj1[key] != obj2[key]) {
                    return false;
                }
            }
            for (x = keys2.length - 1; x >= 0; x -= 1) {
                key = keys2[x];

                if (obj2[key] != obj1[key]) {
                    return false;
                }
            }

            return true;
        },

        $statics: {
            _nameRegExp: /^([a-z0-9_\-]+(\.[a-z0-9_\-]+)*)?$/i,

            /**
             * Checks if a given state name is valid.
             *
             * @param {String} state The state
             *
             * @return {Boolean} True if valid, false otherwise
             */
            isValid: function (name) {
                return this._nameRegExp.test(name);
            }
        }
    });

    return State;
});
