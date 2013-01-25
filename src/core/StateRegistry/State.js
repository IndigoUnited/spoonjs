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
    'has'
], function (Class, StateInterface, keys, values, mixIn, deepClone, has) {

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
                throw new Error('The state name contains unallowed chars.');
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

            // Strict comparation first
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
            }

            return true;
        },


        /**
         * {@inheritDoc}
         */
        isFullyEqual: function (state) {
            // Strict comparation first
            if (this === state) {
                return true;
            }

            // Compare the name
            if (this._name !== state._name) {
                return false;
            }

            // Compare all the params
            var selfParams = mixIn({}, this._params),
                otherParams = mixIn({}, state._params);

            delete selfParams.$state;
            delete otherParams.$state;

            return this._compareObjects(selfParams, otherParams);
        },

        /**
         * {@inheritDoc}
         */
        clone: function () {
            var ret = new State(this._name, deepClone(this._params));
            ret._cursor = this._cursor;

            return ret;
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

            for (x = values1.length - 1; x >= 0; x -= 1) {
                if (values1[x] != values2[x]) {
                    return false;
                }
            }

            return true;
        },

        $statics: {
            _nameRegExp: /^[a-z0-9_\-]+(\.[a-z0-9_\-]+)*$/i,

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
