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

                return true;
            }

            // Otherwise compare them all
            return this._compareObjects(this._params, state._params);
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
            return this._compareObjects(this._params, state._params);
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
                key,
                x;

            remove(keys1, '$state');
            remove(keys2, '$state');

            if (keys1.length !== keys2.length) {
                return false;
            }

            for (x = keys1.length - 1; x >= 0; x -= 1) {
                if (keys2.indexOf(keys2) === -1) {
                    return false;
                }
            }

            for (x = keys1.length - 1; x >= 0; x -= 1) {
                key = keys[x];
                if (obj1[key] !== obj2[key]) {
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
