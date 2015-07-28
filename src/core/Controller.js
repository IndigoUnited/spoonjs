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
    'mout/object/fillIn',
    'mout/object/mixIn',
    'has'
], function (Joint, stateRegistry, startsWith, size, pick, fillIn, mixIn, has) {

    'use strict';

    /**
     * Constructor.
     */
    function Controller() {
        Joint.call(this);

        this._parseStates();
        this._parseDefaultState();
    }

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
     * @param {String}  name       The state name
     * @param {Object}  [params]   The state params
     * @param {Boolean} [absolute] True to generate an absolute URL, false otherwise
     *
     * @return {String} The generated URL
     */
    Controller.prototype.generateUrl = function (name, params, absolute) {
        var resolved;

        // Resolve the state
        resolved = this._resolveState(name, params);

        if (resolved.internal) {
            throw new Error('Cannot generate a URL for internal state "' + name + '" in "' + this.$name + '".');
        }

        return stateRegistry.generateUrl(resolved.fullName, resolved.params, absolute);
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
        var resolved,
            state;

        // Resolve the state
        // Note that parameters are shallow cloned to avoid side-effects
        resolved = this._resolveState(name, mixIn({}, params));

        // If the state is not ours, simply set it on the state registry
        if (resolved.absolute || resolved.relative) {
            stateRegistry.setCurrent(resolved.fullName, resolved.params, options);
            return this;
        }

        // Check if state is internal and the resolved controller is not ourselves
        if (resolved.internal && resolved.controller !== this) {
            resolved.controller.setState(resolved.fullName, resolved.params);
            return this;
        }

        // Act differently if this state is global
        if (resolved.global) {
            // If so attempt to change the global state, aborting if it succeeded
            if (stateRegistry.setCurrent(resolved.fullName, resolved.params, options)) {
                return this;
            }

            // Since the global state is equal, grab it to avoid creating unnecessary
            // state objects
            state = stateRegistry.getCurrent().seekTo(resolved.name);
        } else {
            state = stateRegistry._createStateInstance(resolved.name, resolved.params);

            // Generate local metadata
            state.getParams().$info = {
                newState: state,
                previousState: this._previousState
            };
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
        var name,
            currentState;

        // Assume app state if not passed
        if (state.$info) {
            state = state.$info.newState;
        }

        // Ensure state is filled with the defaults
        this._fillStateIfEmpty(state);

        name = state.getName();

        // If still has no name it means there's no default state defined
        if (!name) {
            if (has('debug') && this._nrStates) {
                console.warn('[spoonjs] No default state defined in "' + this.$name + '".');
            }

            return;
        }

        // Check if state exists
        if (!this._states[name]) {
            if (has('debug')) {
                console.warn('[spoonjs] Unknown state "' + name + '" on controller "' + this.$name + '".');
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
        // Note that the current state might not be set or be changed meanwhile if the user
        // override "_performStateChange()" or "_propagateState()"
        currentState = this._currentState;
        if (stateRegistry.getCurrent() === state && currentState && currentState.getName() === name) {
            this._currentState.setFullName(state.getFullName());
        }

        return this;
    };

    /**
     * Instruct the extend to merge states.
     *
     * {@inheritDoc}
     */
    Controller.extend = function (parent, props, merge) {
        merge = merge || [];
        merge.push('_states');

        return Joint.extend.call(this, parent, props, merge);
    };

    // --------------------------------------------

    /**
     * Fills the state object with the default state if it's name is empty.
     *
     * @param {State} state The state
     */
    Controller.prototype._fillStateIfEmpty = function (state) {
        if (!this._defaultState) {
            return;
        }

        if (state.getName() === this._defaultState.name) {
            fillIn(state.getParams(), this._defaultState.params);
        } else if (!state.getName()) {
            state.setFullName(state.getFullName() + '.' + this._defaultState.name);
            fillIn(state.getParams(), this._defaultState.params);
        }
    };

    /**
     * Parses the controller states.
     */
    Controller.prototype._parseStates = function () {
        var key,
            func,
            matches,
            regExp = this.constructor._stateParamsRegExp || Controller._stateParamsRegExp,
            states = this._states,
            internal;

        this._states = {};
        this._nrStates = size(states);

        // Process the states object
        for (key in states) {
            func = states[key];

            // Check if this state is internal
            if (!key.indexOf('!')) {
                key = key.substr(1);
                internal = true;
            } else {
                internal = false;
            }

            // Process the params specified in the parentheses
            matches = key.match(regExp);
            if (matches) {
                key = key.substr(0, key.indexOf('('));
                this._states[key] = { internal: internal };

                // If user specified state(*), then the state changes every time
                // even if the params haven't changed
                if (matches[1] === '*') {
                    this._states[key].wildcard = true;
                } else {
                    this._states[key].params = matches[1].split(/\s*,\s*/);
                }
            } else {
                this._states[key] = { internal: internal };
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
            this._states[key].params = this._states[key].params || [];
        }
    };

    /**
     * Parse the default state.
     */
    Controller.prototype._parseDefaultState = function () {
        // Convert default state as a string to an object
        if (typeof this._defaultState === 'string') {
            this._defaultState = {
                name: this._defaultState,
                params: {}
            };
        }

        if (has('debug') && this._defaultState) {
            if (!this._defaultState.name) {
                throw new Error('The default state of "' + this.$name + '" cannot be empty.');
            }
            if (!this._states[this._defaultState.name]) {
                throw new Error('The default state of "' + this.$name + '" points to an nonexistent state.');
            }
        }
    },

    /**
     * Resolves a state.
     *
     * If name starts with a / then state is absolute.
     * If name starts with ../ then state is relative.
     * If empty will try to map to the default state.
     * If not empty, strict validation will be made against the name
     *
     * The full state name will be resolved by navigating through the ancestors,
     * unless the state is flagged as internal.
     *
     * @param {String} [name]   The state name
     * @param {Object} [params] The state params
     *
     * @return {Object} An object with the name, params and some flags
     */
    Controller.prototype._resolveState = function (name, params) {
        var resolved,
            ancestor,
            controller,
            fullName,
            localName,
            ancestorState;

        name = name || '';
        params = params || {};

        // Absolute
        if (name.charAt(0) === '/') {
            name = name.substr(1);

            if (has('debug') && !stateRegistry.isRegistered(name)) {
                throw new Error('Resolved "' + name + '" as absolute but its not registered in the state registry.');
            }

            return { fullName: name, params: params, absolute: true };
        }

        // Relative
        if (startsWith(name, '../')) {
            if (has('debug') && (!this._uplink || !(this._uplink instanceof Controller))) {
                throw new Error('Cannot resolve relative state "' + name + '" in "' + this.$name + '" because controller has no parent.');
            }

            resolved = this._uplink._resolveState(name.substr(3), params);
            resolved.relative = true;
            delete resolved.name;

            if (has('debug') && !resolved.global) {
                throw new Error('Relative state "' + name + '" in "' + this.$name + '" is not a global state (only global are supported for now).');
            }

            return resolved;
        }

        // Local
        // Fill in with the default state
        if (!name && this._defaultState) {
            name = this._defaultState.name;
            params = fillIn(params, this._defaultState.params);
        }

        // If name was specified, do some special stuff
        if (name) {
            localName = name.split('.')[0];

            // Validate if state exists
            if (has('debug') && !this._states[localName]) {
                throw new Error('Unknown state "' + localName + '" in "' + this.$name + '".');
            }

            // Is this an internal state? If so end it here..
            if (this._states[localName].internal) {
                return {
                    fullName: name,
                    name: name,
                    params: params,
                    internal: true,
                    controller: this
                };
            }
        }

        // If we end up here, then we need to build the full name based on the ancestors
        fullName = name;

        if (this._uplink) {
            ancestor = this._uplink;

            while (ancestor && ancestor instanceof Controller) {
                ancestorState = ancestor.getState();

                if (!ancestorState) {
                    throw new Error('Unable to resolve full state when controller "' + this.$name + '" is not in any state.');
                }

                // Concatenate name & mix in relevant params
                fullName = ancestorState.getName() + (fullName ? '.' + fullName : '');
                fillIn(params, ancestor._currentStateParams);

                // If the ancestor state is internal, stop here
                if (ancestor._states[ancestorState.getName()].internal) {
                    controller = ancestor;
                    break;
                }

                ancestor = ancestor._uplink;
            }
        }

        // Internal state detected..
        if (controller) {
            return {
                fullName: fullName,
                name: name,
                params: params,
                internal: true,
                controller: controller
            };
        }

        return {
            fullName: fullName,
            name: name,
            params: params,
            global: stateRegistry.isRegistered(fullName)
        };
    };

    /**
     * Checks if a given state is the same as the current controller state.
     *
     * @param {State} state       The state
     * @param {State} [baseState] The state to compare against, defaults to the current state
     *
     * @return {Boolean} True if the same, false otherwise
     */
    Controller.prototype._isSameState = function (state, baseState) {
        var stateMeta;

        baseState = baseState || this._currentState;

        if (!baseState) {
            return false;
        }

        stateMeta = this._states[state.getName()] || {};

        // Check if state is a wildcard
        if (stateMeta.wildcard) {
            return false;
        }

        // Check if equal
        return baseState.isEqual(state, stateMeta.params);
    };

    /**
     * Sets the current state based on the passed in state.
     * Updates all the necessary properties used internally.
     *
     * @param {State} state The state
     */
    Controller.prototype._setCurrentState = function (state) {
        var params;

        // Update current state
        this._previousState = this._currentState;
        this._currentState = state.clone();
        this._currentStateParams = pick(this._currentState.getParams(), this._states[this._currentState.getName()].params);

        // Ensure $info gets up to date
        params = this._currentState.getParams();
        if (params.$info) {
            params.$info.newState = this._currentState;
        }

        // Update the state registry one
        if (state === stateRegistry.getCurrent() && state.getFullName() !== this._currentState.getFullName()) {
            state.setFullName(this._currentState.getFullName());
        }
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
            leadingName,
            curr,
            length,
            x;

        // Update internal state
        this._setCurrentState(state);

        // Advance pointer
        state.next();

        // Find suitable child controller to handle the state
        name = state.getName();
        leadingName = state.getLeadingName();
        length = this._downlinks.length;

        // The first cycle on the down links are more strict to ensure we
        // don't match the wrong child
        for (x = 0; x < length; x += 1) {
            curr = this._downlinks[x];

            if (!(curr instanceof Controller)) {
                continue;
            }

            if (!name) {
                if (curr._defaultState && stateRegistry.isRegistered(state.getFullName() + '.' + curr._defaultState.name)) {
                    return curr.delegateState(state);
                }
            } else if (curr._currentState && curr._currentState.getLeadingName() === leadingName) {
                return curr.delegateState(state);
            }
        }

        // The second cycle is loose and only works if we got a state
        if (name) {
            for (x = 0; x < length; x += 1) {
                curr = this._downlinks[x];

                if (!(curr instanceof Controller)) {
                    continue;
                }

                if (curr._states[name]) {
                    return curr.delegateState(state);
                }
            }

            if (has('debug')) {
                console.warn('[spoonjs] No child controller of "' + this.$name + '" can handle the "' + name + '" state.');
            }
        }
    };

    Controller._stateParamsRegExp = /\((.+?)\)/;

    return Controller;
});
