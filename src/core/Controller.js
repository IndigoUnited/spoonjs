/*jshint regexp:false*/

/**
 * Controller abstract class.
 */
define([
    './Joint',
    'services/state',
    'mout/string/startsWith',
    'mout/object/size',
    'mout/object/mixIn',
    'mout/array/find',
    'has'
], function (Joint, stateRegistry, startsWith, size, mixIn, find, has) {

    'use strict';

    /**
     * Constructor.
     */
    function Controller() {
        Joint.call(this);

        this._parseStates();
    }

    Controller.extend = Joint.extend;
    Controller.prototype = Object.create(Joint.prototype);
    Controller.prototype.constructor = Controller;

    /**
     * Get the current state or null if none is set.
     *
     * @return {State} The state
     */
    Controller.prototype.getState = function () {
        return this._currentState;
    };

    /**
     * Generates an URL for a state.
     *
     * @param {String} state    The state name
     * @param {Object} [params] The state params
     *
     * @return {String} The generated URL
     */
    Controller.prototype.generateUrl = function (state, params) {
        // TODO: allow a state object, state instance similar to setState?
        return stateRegistry.generateUrl(this._resolveFullState(state), params);
    };

    /**
     * Sets the current state.
     * If the state is the same, nothing happens.
     *
     * @param {...mixed} [state]   The state name, the state parameter bag or a state instance
     * @param {Object}   [params]  The state params to be used if the state is a string
     * @param {Object}   [options] The options
     *
     * @return {Controller} The instance itself to allow chaining
     */
    Controller.prototype.setState = function (state, params, options) {
        var name,
            fullName;

        if (!this._nrStates) {
            return this;
        }

        // 1st - Try to make the state transition globally and only proceed if it didn't changed
        //       Also extract the local and full name of the state
        if (!state || typeof state === 'string') {
            // Resolve to the full name
            fullName = this._resolveFullState(state);

            // Change the state globally, and abort if actually changed
            if (stateRegistry.setCurrent(fullName, params, options)) {
                return this;
            }

            name = state;
        } else {
            state = state.$info ? state.$info.newState : state;

            // Change the state globally, and abort if actually changed
            if (stateRegistry.setCurrent(state, options)) {
                return this;
            }

            name = state.getName();
            params = state.getParams();
        }

        state = stateRegistry.getCurrent();
        state.setParams(params);

        // 2nd - If no name is found check if we got a default state
        if (!name && !this._defaultState) {
            if (has('debug')) {
                console.warn('No default state defined in "' + this.$name + '".');
            }

            return;
        }

        // 3rd - Check if the state of the controller actually changed
        if (!this._isSameState(state)) {
            this._performStateChange(state);
        // 4th - If not, propagate the state downwards
        } else {
            this._propagateState(state);
        }

        // 5th - Sync up the full state name with the application one
        //       This is needed because default states might have been translated down the chain
        if (stateRegistry.getCurrent() === state) {
            this._currentState.setFullName(state.getFullName());
        }

        return this;
    };

    //////////////////////////////////////////////////////////////////

    /**
     * Parses the controller states.
     */
    Controller.prototype._parseStates = function () {
        var key,
            tmp,
            func,
            matches,
            regExp = this.constructor._stateParamsRegExp || Controller._stateParamsRegExp;

        // Clone events object to guarantee unicity among instances
        this._states = this._states ? mixIn({}, this._states) : {};
        this._statesParams = {};
        this._statesWildcards = {};
        this._nrStates = size(this._states);

        // Process the states object
        for (key in this._states) {
            // Process the params specified in the parentheses
            matches = key.match(regExp);
            if (matches) {
                tmp = key.substr(0, key.indexOf('('));
                this._states[tmp] = this._states[key];
                delete this._states[key];
                key = tmp;

                // If user specified state(*), then the state changes every time
                // even if the params haven't changed
                if (matches[1] === '*') {
                    this._statesWildcards[key] = true;
                } else {
                    this._statesParams[key] = matches[1].split(',');
                }
            } else {
                this._statesParams[key] = [];
            }

            if (has('debug')) {
                if (!stateRegistry.isValid(key)) {
                    throw new Error('State name "' + key + '" of "' + this.$name + '" has an invalid format.');
                }
                if (key.indexOf('.') !== -1) {
                    throw new Error('State name "' + key + '" of "' + this.$name + '" must be local (cannot contain dots).');
                }
            }

            // Check if it is a string or already a function
            func = this._states[key];
            if (typeof func === 'string') {
                func = this[func];
                this._states[key] = func;
            }
            if (has('debug') && typeof func !== 'function') {
                throw new Error('State handler "' + key + '" of "' + this.$name + '" references a nonexistent function.');
            }
        }

        // Process the default state
        if (has('debug') && this._defaultState && !this._states[this._defaultState]) {
            throw new Error('The default state of "' + this.$name + '" points to an nonexistent state.');
        }
    },

    /**
     * Checks if a given state is the same as the current controller state.
     *
     * @param {StateInterface} state The state
     *
     * @return {Boolean} True if the same, false otherwise
     */
    Controller.prototype._isSameState = function (state) {
        var params;

        if (!this._currentState) {
            return false;
        }

        // Translate to default state if name is empty
        if (!state.getName() && this._currentState.getName() === this._defaultState) {
            state = state.clone();
            state.setFullName(state.getFullName() + '.' + this._defaultState);
        }

        // Check if state is a wildcard
        if (this._statesWildcards[state.getName()]) {
            return false;
        }

        // Check if equal
        params = this._statesParams[state.getName()];

        return this._currentState.isEqual(state, params);
    };

    /**
     * Resolves a full state name.
     *
     * If name starts with a / then state is absolute.
     * If name starts with ../ then state is relative.
     * If empty will try to map to the default state.
     * Otherwise the full state name will be resolved from the local name.
     *
     * @param {String} [name] The state name
     *
     * @return {String} The full state name
     */
    Controller.prototype._resolveFullState = function (name) {
        var matches,
            length,
            curr,
            currState,
            x;

        // Empty
        if (!name) {
            return '';
        }

        // Absolute
        if (name.charAt(0) === '/') {
            return name.substr(1);
        }

        // Relative
        if (startsWith(name, '../')) {
            matches = name.split(this.constructor._relativeStateRegExp),
            length = matches.length,
            curr = this;

            for (x = 0; x < length - 1; x += 1) {
                if (has('debug') && (!curr._uplink || !(curr._uplink instanceof Controller))) {
                    throw new Error('Cannot generate full state from "' + name + '" in "' + this.name + '".');
                }
                curr = curr._uplink;
            }

            return curr._resolveFullState(matches[length - 1] || null);
        }

        // Local
        curr = this._uplink;
        while (curr && curr instanceof Controller) {
            currState = curr.getState();
            // If this ancestor controller has no current state
            // and it has states, then something is wrong
            if (!currState) {
                if (curr._nrStates && has('debug')) {
                    throw new Error('Unable to resolve full state: "' + curr.$name + '" has no current state.');
                }
                // Break here, the ancestor has no states defined
                break;
            }
            name = currState.getName() + (name ? '.' + name : '');
            curr = curr._uplink;
        }

        return name;
    };

    /**
     * Performs the state change, calling the state handler if any.
     *
     * @param {StateInterface} state The state
     */
    Controller.prototype._performStateChange = function (state) {
        var name,
            fullName;

        this._currentState = state.clone();

        // Resolve to default state always
        if (!state.getName() && this._defaultState) {
            fullName = state.getFullName() ? state.getFullName() + '.' + this._defaultState : this._defaultState;
            this._currentState.setFullName(fullName);
            stateRegistry.getCurrent().setFullName(fullName); // Update also the state registry one
        }

        name = this._currentState.getName();
        state.next();

        if (this._states[name]) {
            this._states[name].call(this, state.getParams());
        } else if (has('debug')) {
            console.warn('Unhandled state "' + name + '" on controller "' + this.$name + '".');
        }
    };

    /**
     * Attempts to propagate the state to one of the downlinks.
     *
     * @param {StateInterface} state The state
     */
    Controller.prototype._propagateState = function (state) {
        var name,
            fullName,
            curr,
            length,
            x;

        this._currentState = state.clone();

        // Resolve to default state always
        if (!state.getName() && this._defaultState) {
            fullName = state.getFullName() ? state.getFullName() + '.' + this._defaultState : this._defaultState;
            this._currentState.setFullName(fullName);
            stateRegistry.getCurrent().setFullName(fullName); // Update also the state registry one
        }

        state.next();
        name = state.getName();
        length = this._downlinks.length;

        for (x = 0; x < length; x += 1) {
            curr = this._downlinks[x];

            if (curr instanceof Controller) {
                if (curr._states[name] || (!name && curr._defaultState)) {
                    curr.setState(state);
                    return;
                }
            }
        }

        if (name && has('debug')) {
            console.warn('No child controller of "' + this.$name + '" knows how to handle state "' + name + '"');
        }
    };

    ////////////////////////////////////////////////////////////////

    Controller._stateParamsRegExp = /\((.+?)\)/;
    Controller._relativeStateRegExp = /\.\.\//;

    return Controller;
});
