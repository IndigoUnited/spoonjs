/*jshint eqeqeq:false*/

/**
 * State class.
 */
define([
    'mout/object/keys',
    'mout/object/values',
    'mout/object/mixIn',
    'mout/lang/deepClone',
    'mout/array/remove',
    'has'
], function (keys, values, mixIn, deepClone, remove, has) {

    'use strict';

    /**
     * Constructor.
     * Special parameters can be prefixed with $.
     * Those will not be taken into account in the comparisons.
     *
     * @param {String} name     The state name
     * @param {Object} [params] The state parameters
     */
    function State(name, params) {
        this._nrParts = 0;
        this._cursor = 0;

        this.setFullName(name);
        this.setParams(params);
    }

    /**
     * Get the full state name.
     *
     * @return {String} The full state name
     */
    State.prototype.getFullName = function () {
        return this._name;
    };

    /**
     * Sets the full state name.
     *
     * @param {String} name The full state name
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.setFullName = function (name) {
        if (has('debug') && !this.constructor.isValid(name)) {
            throw new Error('State name "' + name + '" has an invalid format.');
        }

        this._name = name;
        this._parts = name.split('.');
        this._nrParts = this._parts.length;
        this.setCursor(this._cursor);

        return this;
    };

    /**
     * Get the state name (the name imediatly after the current cursor position).
     *
     * @return {String} The name
     */
    State.prototype.getName = function () {
        return this._cursor < this._nrParts ? this._parts[this._cursor] : null;
    };

    /**
     * Get the state parameters.
     *
     * @return {Object} The state parameters
     */
    State.prototype.getParams = function () {
        return this._params;
    };

    /**
     * Set the state parameters.
     *
     * @param {Object} params The state parameters
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.setParams = function (params) {
        this._params = params || {};

        return this;
    };

    /**
     * Advance the cursor position.
     * Note that the cursor is allowed to move forward to the last position, so that getName() returns null.
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.next = function () {
        if (this._cursor < this._nrParts) {
            this._cursor += 1;
        }

        return this;
    };

    /**
     * Recede the cursor position.
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.previous = function () {
        if (this._cursor > 1) {
            this._cursor -= 1;
        }

        return this;
    };

    /**
     * Get the current cursor position.
     *
     * @return {Number} The cursor position
     */
    State.prototype.getCursor = function () {
        return this._cursor;
    };

    /**
     * Sets the current cursor position.
     *
     * @param {Number} The new position
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.setCursor = function (cursor) {
        if (this._cursor > this._nrParts) {
            this._cursor = this._nrParts;
        } else if (this._cursor < 0) {
            this._cursor = 0;
        } else {
            this._cursor = cursor;
        }

        return this;
    };

    /**
     * Compares the instance to another one.
     * The state is considered to the same if the name and parameters are the same.
     * If parameter names are passed, those will be compared.
     * If no parameter names are passed, all parameters are compared.
     *
     * @param {State} state         The state
     * @param {Array} [stateParams] An array of parameter names to be compared
     *
     * @return {Boolean} True if the state is the same, false otherwise
     */
    State.prototype.isEqual = function (state, stateParams) {
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
        if (stateParams) {
            for (x = stateParams.length - 1; x >= 0; x -= 1) {
                curr = stateParams[x];
                if (this._params[curr] != state._params[curr]) {
                    return false;
                }
            }

            return true;
        }

        // Otherwise compare them all
        return this._compareObjects(this._params, state._params);
    };

    /**
     * Compares the instance to another one.
     * The state is considered to be fully equal if the full state name and parameters are the same.
     *
     * @param {State} state The state
     *
     * @return {Boolean} True if the state is fully equal, false otherwise.
     */
    State.prototype.isFullyEqual = function (state) {
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
    };

    /**
     * Clones the state.
     *
     * @return {State} The cloned state
     */
    State.prototype.clone = function () {
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
    };

    ////////////////////////////////////////////////////////

    /**
     * Compares two objects loosely and not recursively.
     *
     * @param {Object} obj1 The first object to be compared
     * @param {Object} obj2 The second object to be compared
     * 
     * @return {Boolean} True if they are loosely equal, false otherwise
     */
    State.prototype._compareObjects = function (obj1, obj2) {
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
    };

    ////////////////////////////////////////////////////////

    State._nameRegExp = /^([a-z0-9_\-]+(\.[a-z0-9_\-]+)*)?$/i;

    /**
     * Checks if a given state name is valid.
     *
     * @param {String} name The state name
     *
     * @return {Boolean} True if valid, false otherwise
     */
    State.isValid = function (name) {
        var regExp = this._nameRegExp || State._nameRegExp;

        return regExp.test(name);
    };

    return State;
});
