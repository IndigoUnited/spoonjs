/*jshint regexp:false*/

/**
 * Controller abstract class.
 */
define([
    './Joint',
    'services/state',
    'mout/string/startsWith',
    'mout/object/size',
    'mout/object/pick',
    'mout/object/mixIn',
    'mout/array/find',
    'has'
], function (Joint, stateRegistry, startsWith, size, pick, mixIn, find, has) {

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
     * @param {String} name     The state name
     * @param {Object} [params] The state params
     *
     * @return {String} The generated URL
     */
    Controller.prototype.generateUrl = function (name, params) {
        var state;

        // Resolve the state
        state = this._resolveFullState(name);
        mixIn(state.params, params);

        return stateRegistry.generateUrl(state.fullName, state.params);
    };

    /**
     * Sets the current state.
     * If the state is the same, nothing happens.
     *
     * @param {String} [name]    The state name
     * @param {Object} [params]  The state params
     * @param {Object} [options] The options
     *
     * @return {Controller} The instance itself to allow chaining
     */
    Controller.prototype.setState = function (name, params, options) {
        var state;

        // Resolve the state
        state = this._resolveFullState(name);
        mixIn(state.params, params);

        // If the state is global, simply set it on the state registry
        if (state.name == null) {
            stateRegistry.setCurrent(state.fullName, state.params, options);
            return this;
        }

        // At this point the state is local
        // Check if the state is globally registered
        if (stateRegistry.isRegistered(state.fullName)) {
            // If so attempt to change the global state, aborting if it succeeded
            if (stateRegistry.setCurrent(state.fullName, state.params, options)) {
                return this;
            }
        // Otherwise, the state is meant to be used only by this controller
        } else {
            state = stateRegistry._createStateInstance(state.name, state.params);
        }

        return this.delegateState(state);
    };

    /**
     * Delegates a state to be handled by the controller.
     *
     * @param {Object|State} state The state parameter bag or a state instance
     *
     * @return {Controller} The instance itself to allow chaining
     */
    Controller.prototype.delegateState = function (state) {
        var name;

        // Assume app state if not passed
        if (!state) {
            state = stateRegistry.getCurrent();
        }

        state = state && (state.$info ? state.$info.newState : state);
        name = state && state.getName() || this._defaultState;

        // If still has no name it means there's no default state defined
        if (!name) {
            if (has('debug') && this._nrStates) {
                console.warn('No default state defined in "' + this.$name + '".');
            }

            return;
        }

        // Check if state exists
        if (!this._states[name]) {
            if (has('debug')) {
                console.warn('Unknown state "' + name + '" on controller "' + this.$name + '".');
            }

            return;
        }

        // If the current state is not the same, transition to it
        if (!this._isSameState(state)) {
            this._performStateChange(state);
        // Otherwise propagate it to child controllers
        } else {
            this._propagateState(state);
        }

        // Sync up the full state name with the application one
        // This is needed because default states might have been translated down the chain
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
            func,
            matches,
            regExp = this.constructor._stateParamsRegExp || Controller._stateParamsRegExp,
            states = this._states;

        this._states = {};
        this._nrStates = size(this._states);

        // Process the states object
        for (key in states) {
            func = states[key];

            // Process the params specified in the parentheses
            matches = key.match(regExp);
            if (matches) {
                key = key.substr(0, key.indexOf('('));
                this._states[key] = {};

                // If user specified state(*), then the state changes every time
                // even if the params haven't changed
                if (matches[1] === '*') {
                    this._states[key].wildcard = true;
                } else {
                    this._states[key].params = matches[1].split(/\s*,\s*/);
                }
            } else {
                this._states[key] = {};
                this._states[key].params = [];
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
            if (typeof func === 'string') {
                func = this[func];
                this._states[key].fn = func;
            }

            if (has('debug') && typeof func !== 'function') {
                throw new Error('State handler "' + key + '" of "' + this.$name + '" references a nonexistent function.');
            }

            this._states[key].fn = func;
        }

        // Process the default state
        if (has('debug') && this._defaultState && !this._states[this._defaultState]) {
            throw new Error('The default state of "' + this.$name + '" points to an nonexistent state.');
        }
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
     * @return {Object} The full state name and params
     */
    Controller.prototype._resolveFullState = function (name) {
        var state,
            ancestor,
            ancestorState;

        name = name || '';

        // Absolute
        if (name.charAt(0) === '/') {
            return {
                fullName: name.substr(1),
                params: {}
            };
        }

        // Relative
        if (startsWith(name, '../')) {
            if (has('debug') && (!this._uplink || !(this._uplink instanceof Controller))) {
                throw new Error('Cannot resolve relative state "' + name + '" in "' + this.$name + '".');
            }

            state = this._uplink._resolveFullState(name.substr(3));
            delete state.name;  // Remove name because state is not local

            return state;
        }

        state = {
            name: name,
            fullName: name,
            params: {}
        };

        // Local
        ancestor = this._uplink;
        while (ancestor && ancestor instanceof Controller) {
            ancestorState = ancestor.getState();
            if (!ancestorState) {
                // Break here, the ancestor is not in any state
                break;
            }

            // Concatenate name & mix in relevant params
            state.fullName = ancestorState.getName() + (state.fullName ? '.' + state.fullName : '');
            mixIn(state.params, ancestor._currentStateParams);

            ancestor = ancestor._uplink;
        }

        // Ensure names
        state.name = state.name || this._defaultState || '';
        state.fullName = state.fullName || this._defaultState || '';

        return state;
    };

    /**
     * Checks if a given state is the same as the current controller state.
     *
     * @param {State} state The state
     *
     * @return {Boolean} True if the same, false otherwise
     */
    Controller.prototype._isSameState = function (state) {
        var stateMeta;

        if (!this._currentState) {
            return false;
        }

        // Translate to default state if name is empty
        if (!state.getName()) {
            state = state.clone();
            state.setFullName(state.getFullName() + '.' + this._defaultState);
        }

        stateMeta = this._states[state.getName()];

        // Check if state is a wildcard
        if (stateMeta.wildcard) {
            return false;
        }

        // Check if equal
        return this._currentState.isEqual(state, stateMeta.params);
    };

    /**
     * Sets the current state based on the passed in state.
     * Updates all the necessary properties used internally.
     *
     * @param {State} state The state
     */
    Controller.prototype._setCurrentState = function (state) {
        var name,
            fullName,
            stateMeta;

        // Update current state
        this._currentState = state.clone();

        // Resolve to default state always
        if (!state.getName() && this._defaultState) {
            fullName = state.getFullName() ? state.getFullName() + '.' + this._defaultState : this._defaultState;
            this._currentState.setFullName(fullName);

            // Update also the state registry one
            if (state === stateRegistry.getCurrent()) {
                state.setFullName(fullName);
            }
        }

        name = this._currentState.getName();
        stateMeta = this._states[name];

        // Update state params being used by this controller
        this._currentStateParams = pick(this._currentState.getParams(), stateMeta.params);
    };

    /**
     * Performs the state change, calling the state handler if any.
     *
     * @param {State} state The state
     */
    Controller.prototype._performStateChange = function (state) {
        var stateMeta;

        // Update internal state
        this._setCurrentState(state);

        // Advance pointer
        state.next();

        // Execute handler
        stateMeta = this._states[this._currentState.getName()];
        stateMeta.fn.call(this, state.getParams());
    };

    /**
     * Attempts to propagate the state to one of the downlinks.
     *
     * @param {State} state The state
     */
    Controller.prototype._propagateState = function (state) {
        var name,
            curr,
            length,
            x;

        // Update internal state
        this._setCurrentState(state);

        // Advance pointer
        state.next();

        // Find suitable child controller to handle the state
        name = state.getName();
        length = this._downlinks.length;

        for (x = 0; x < length; x += 1) {
            curr = this._downlinks[x];

            if (curr instanceof Controller) {
                if (curr._states[name] || (!name && curr._defaultState)) {
                    curr.delegateState(state);
                    return;
                }
            }
        }

        if (name && has('debug')) {
            console.warn('No child controller of "' + this.$name + '" declared the "' + name + '" state.');
        }
    };

    ////////////////////////////////////////////////////////////////

    Controller._stateParamsRegExp = /\((.+?)\)/;

    return Controller;
});
