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
        _pos: 0,
        _cursor: 0,

        /**
         * Constructor.
         *
         * @param {String} name      The state name
         * @param {Object} [$params] The state parameters
         */
        initialize: function (name, $params) {
            if (has('debug') && (!name || name.charAt(0) === '.' || name.charAt(0) === '/')) {
                console.log(name);
                throw new Error('State names cannot be empty and cannot start with a dot and a slash.');
            }

            this._name = name;
            this._params = $params || {};
            this._params.$state = this;
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
        getName: function () {
            if (this._pos === -1) {
                return null;
            }

            var branchName = this._name.substr(!this._pos ? this._pos : this._pos + 1),
                dotPos = branchName.indexOf('.');

            return dotPos === -1 ? branchName : branchName.substr(0, dotPos);
        },

        /**
         * {@inheritDoc}
         */
        setName: function (name) {
            if (name.indexOf('.') !== -1) {
                throw new Error('Name parts cannot contain a dot.');
            }

            var parts = this._name.split('.');

            parts.splice(this._cursor, 1, name);
            this._name = parts.join('.');

            return this;
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

            return this;
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
            var ret = new State(this._name);
            ret._params = deepClone(this._params);
            ret._pos = this._pos;
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
        }
    });

    return State;
});
