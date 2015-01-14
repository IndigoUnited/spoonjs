/*jshint eqeqeq:false*/

/**
 * State class.
 */
define([
    'mout/lang/deepClone',
    'mout/lang/deepEquals',
    'mout/object/filter',
    'mout/array/difference',
    'has'
], function (deepClone, deepEquals, filter, difference, has) {

    'use strict';

    /**
     * Constructor.
     *
     * Special parameters can be prefixed with $.
     * Those will not be taken into account in the comparisons.
     *
     * @param {String} name     The state name
     * @param {Object} [params] The state parameters
     */
    function State(name, params) {
        this._nrParts = 0;
        this._cursor = 0;

        this._filterSpecial = this.constructor.filterSpecial || State.filterSpecial;

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
     * Get the leading state name (all parts before the cursor).
     *
     * @return {String} The leading name
     */
    State.prototype.getLeadingName = function () {
        return this._parts.slice(0, this._cursor).join('.');
    };

    /**
     * Get the trainling state name (all parts after the cursor).
     *
     * @return {String} The trailing name
     */
    State.prototype.getTraliningName = function () {
        return this._parts.slice(this._cursor + 1).join('.');
    };


    /**
     * Get the state name (the name immediately after the current cursor position).
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
     * Note that the cursor is allowed to move after the last position, so that getName() returns null.
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
     * Note that the cursor is allowed to move behind to the first position, so that getName() returns null.
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.previous = function () {
        if (this._cursor >= 0) {
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
     * Seeks the cursor position to the part that matches a name.
     * Starts looking from the last position.
     *
     * @param {String} name The name to seek
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.seekTo = function (name) {
        var currName;

        // Go to last position
        this.setCursor(this._nrParts - 1);

        // Search it until we reach the head
        while ((currName = this.getName())) {
            if (currName === name) {
                break;
            }

            this.previous();
        }

        return this;
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
        var ret;

        // Create new state
        ret = new State(this._name, deepClone(this._params));
        ret._cursor = this._cursor;

        return ret;
    };

    // --------------------------------------------

    /**
     * Compares two objects.
     *
     * @param {Object} obj1 The first object to be compared
     * @param {Object} obj2 The second object to be compared
     *
     * @return {Boolean} True if they are equal, false otherwise
     */
    State.prototype._compareObjects = function (obj1, obj2) {
        // Remove special keys
        obj1 = this._filterSpecial(obj1);
        obj2 = this._filterSpecial(obj2);

        return deepEquals(obj1, obj2);
    };

    State._nameRegExp = /^[a-z0-9_\-]+(\.[a-z0-9_\-]+)*$/i;

    // --------------------------------------------

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

    /**
     * Filters special params from a object.
     *
     * @param {Object} params The params to filter
     *
     * @return {Object} The filtered params
     */
    State.filterSpecial = function (params) {
        return filter(params, function (value, key) {
            return key.charAt(0) !== '$';
        });
    };

    return State;
});
