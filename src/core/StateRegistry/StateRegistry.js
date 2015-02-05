/*jshint loopfunc:true*/

/**
 * StateRegistry class.
 */
define([
    'events-emitter/MixableEventsEmitter',
    './State',
    './Route',
    'mout/array/find',
    'mout/array/findIndex',
    'mout/array/remove',
    'mout/object/hasOwn',
    'mout/object/mixIn',
    'mout/string/startsWith',
    'mout/queryString/decode',
    'mout/queryString/encode',
    'has',
    'jquery'
], function (MixableEventsEmitter, State, Route, find, findIndex, remove, hasOwn, mixIn, startsWith, decode, encode, has, $) {

    'use strict';

    /**
     * Constructor.
     */
    function StateRegistry() {
        this._states = {};
        this._routes = [];
        this._interceptors = [];

        // Replace all functions that need to be bound
        this._handleLinkClick = this._handleLinkClick.bind(this);

        $(document.body).on('click', 'a', this._handleLinkClick);
    }

    mixIn(StateRegistry.prototype, MixableEventsEmitter.prototype);

    /**
     * Sets the address.
     *
     * @param {Address} [address] The address to set or null to unset it
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.setAddress = function (address) {
        this.unsetAddress();

        if (address) {
            this._address = address;
            this._address.enable();
            address.on('change', this._onAddressChange, this);
        }

        return this;
    };

    /**
     * Unsets the address.
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.unsetAddress = function () {
        if (this._address) {
            this._address.enable();
            this._address.off('change', this._onAddressChange, this);
            this._address = null;
            this._currentUrl = null;
        }
    };

    /**
     * Parses a given route.
     * If no route is passed, the current address value is used.
     * If a state is found for the route and is different from the current one, a transition
     * will occur and the change event will be emitted.
     * If not state is found, a unknown event will be fired instead.
     *
     * This function is handy to kick-off the state registry.
     *
     * @param {String} [route]   The route (URL fragment)
     * @param {Object} [options] The options, see StateRegistry#setCurrent
     *
     * @return {Boolean} True if it changed state, false otherwise
     */
    StateRegistry.prototype.parse = function (route, options) {
        // Manually call the change handler with the passed route
        // or the address value (if available)
        var obj = {
            newValue: route != null ? route : (this._address ? this._address.getValue() : ''),
            oldValue: null,
            type: 'external'
        };

        return this._onAddressChange(obj, options);
    };

    /**
     * Registers a state with a route and default options.
     *
     * An error will be thrown if the state being registered already exists.
     *
     * @param {String}    state      The state
     * @param {Route}    [route]     The route associated to the state
     * @param {Function} [validator] A validator to be run before entering the state
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.register = function (state, route, validator) {
        if (has('debug') && this._states[state]) {
            throw new Error('State "' + state + '" is already registered.');
        }

        // Add to the states object
        this._states[state] = {
            route: route,
            validator: validator
        };

        // Add to the routes array
        if (route) {
            this._routes.push(route);
        }

        return this;
    };

    /**
     * Unregisters a state.
     *
     * @param {String} state The state
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.unregister = function (state) {
        var registered = this._states[state];

        // Remove it from the states object
        delete this._states[state];

        if (registered && registered.route) {
            // Remote it from the routes array
            remove(this._routes, registered.route);
        }

        return this;
    };

    /**
     * Unregisters all the registered states.
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.unregisterAll = function () {
        this._states = {};
        this._routes = [];

        return this;
    };

    /**
     * Checks if a state is registered.
     *
     * @param {String} state The state
     *
     * @return {Boolean} True if it is, false otherwise
     */
    StateRegistry.prototype.isRegistered = function (state) {
        return hasOwn(this._states, state);
    };

    /**
     * Checks if state is registered and has a route associated to it.
     *
     * @param {String} state The state
     *
     * @return {Boolean} True if it is, false otherwise
     */
    StateRegistry.prototype.isRoutable = function (state) {
        var registered = this._states[state];

        return !!(registered && registered.route);
    };

    /**
     * Checks if a given state name is valid.
     *
     * @param {String} state The state
     *
     * @return {Boolean} True if valid, false otherwise
     */
    StateRegistry.prototype.isValid = function (state) {
        return State.isValid(state);
    };

    /**
     * Sets the current state.
     * If the state is not the same, the change event will be emitted.
     * Also if the state has a route associated and the routing is enabled, the browser URL will be updated accordingly.
     *
     * The default implementation should handle these options:
     *  - force:        true to force the value to be changed even if the value is the same
     *  - route:        false to not change the address value
     *  - replace:      true to replace the address value instead of adding a new history entry
     *  - silent:       true to silently change the state, without emitting an event
     *  - interceptors: true to run the interceptors, false otherwise
     *
     * @param {String|State} state     The state name or the state object
     * @param {Object}       [params]  The state parameters if the state was a string
     * @param {Object}       [options] The options
     *
     * @return {Boolean} True if the current state is not the same, false otherwise
     */
    StateRegistry.prototype.setCurrent = function (state, params, options) {
        var that = this;

        // Handle args
        if (typeof state === 'string') {
            state = this._createStateInstance(state, params);
        } else {
            options = params;
        }

        // Set default options and merge them with the user ones
        options = mixIn({
            force: false,
            route: true,
            replace: !this._currentState,  // Replace URL if it's the first state
            silent: false,
            interceptors:  true
        }, options);

        // Only change if the current state is not the same
        if (this.isCurrent(state) && !options.force) {
            return false;
        }

        // Handle interceptors before changing the state
        this._handleInterceptors(options.interceptors, state, function (advance) {
            var url,
                registered = that._states[state.getFullName()],
                err;

            // Run the state validator if the interceptors told us to advance the state
            if (advance && registered && registered.validator) {
                try {
                    registered.validator(state.getParams());
                } catch (e) {
                    advance = false;
                    err = e;
                    err.state = state;
                }
            }

            // If we should not advance because of an interceptor or because of a state validator,
            // restore address value and abort!
            if (!advance) {
                if (that._address) {
                    url = that._currentState && that._getStateUrl(that._currentState);

                    if (url) {
                        that._currentUrl = url;
                        that._address.setValue(url, { replace: true });
                    }
                }

                if (err) {
                    that._emit('error', err);
                } else {
                    that._emit('cancel', state);
                }
            // Otherwise proceed to change..
            } else {
                that._previousState = that._currentState;
                that._currentState = state;

                // Handle after change stuff
                that._postChangeHandler(options);
            }
        });

        return true;
    };

    /**
     * Returns the current state.
     *
     * @return {State} The state
     */
    StateRegistry.prototype.getCurrent = function () {
        return this._currentState;
    };

    /**
     * Check if the current state is the same as the passed one.
     *
     * @param {String|State} state    The state name or the state object
     * @param {Object}       [params] The state parameters if the state was a string
     *
     * @return {Boolean} True if it is, false otherwise
     */
    StateRegistry.prototype.isCurrent = function (state, params) {
        // If no state is set simply return false
        if (!this._currentState) {
            return false;
        }

        // Build the state object
        if (typeof state === 'string') {
            state = this._createStateInstance(state, params);
        }

        return this._currentState.isFullyEqual(state);
    };

    /**
     * Generates an URL for a given state.
     * If no route is associated with the state, a state:// URL will be generated.
     *
     * @param {String|State} state      The state name or the state object
     * @param {Object}       [params]   The state parameters if the state was a string
     * @param {Boolean}      [absolute] True to only generate an absolute URL, false otherwise
     *
     * @return {String} The URL for the state or null if unable to generate one
     */
    StateRegistry.prototype.generateUrl = function (state, params, absolute) {
        var url;

        if (typeof state !== 'string') {
            absolute = params;
        } else {
            state = this._createStateInstance(state, params);
        }

        url = this._getStateUrl(state);
        if (!url || !this._address) {
            params = State.filterSpecial(state.getParams());
            return 'state://' + state.getFullName() + '/' + encode(params);
        }

        return this._address.generateUrl(url, absolute);
    };

    /**
     * Configures a interceptor that will be run before actually changing the state.
     * This easily allows use cases such as "are you sure you want to quit".
     *
     * The interceptor will be added to the start of the interceptors array.
     *
     * @param {Function} fn  The interceptor
     * @param {Object}   ctx The context
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.addInterceptor = function (fn, ctx) {
        if (this._interceptors.running) {
            throw new Error('Cannot add interceptor while running them');
        }

        this.removeInterceptor(fn, ctx);
        this._interceptors.unshift({ fn: fn, ctx: ctx });

        return this;
    };

    /**
     * Removes a previously added interceptor.
     *
     * @param {Function} fn The interceptor
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.removeInterceptor = function (fn, ctx) {
        var index;

        if (this._interceptors.running) {
            throw new Error('Cannot remove interceptor while running them');
        }

        index = findIndex(this._interceptors, function (obj) {
            return obj.fn === fn && obj.ctx === ctx;
        });

        if (index !== -1) {
            this._interceptors.splice(index, 1);
        }

        return this;
    };

    /**
     * Destroys the instance.
     */
    StateRegistry.prototype.destroy = function () {
        if (!this._destroyed) {
            this._onDestroy();
            this._destroyed = true;
        }
    };

    // --------------------------------------------

    /**
     * Creates a new state instance.
     *
     * @param {String} state    The state name
     * @param {Object} [params] The state parameters if the state was a string
     *
     * @return {State} The state instance
     */
    StateRegistry.prototype._createStateInstance = function (state, params) {
        return new State(state, params);
    };

    /**
     * Handles stuff after the state has changed.
     *
     * @param {Object} options The options
     */
    StateRegistry.prototype._postChangeHandler = function (options) {
        var state = this._currentState.getFullName(),
            params = this._currentState.getParams(),
            url,
            tmp,
            fullName;

        if (has('debug')) {
            console.info('[spoonjs] State changed to "' + state + '".');
            if (!this.isRegistered(state)) {
                console.warn('[spoonjs] State "' + state + '" is not registered.');
            }
        }

        params.$info = params.$info || {};
        params.$info.newState = this._currentState;
        params.$info.previousState = this._previousState;

        // Set address value
        if (this._address && options.route) {
            url = this._getStateUrl(this._currentState);
            if (url) {
                this._currentUrl = url;
                this._address.setValue(url, options);
            }
        }

        fullName = this._currentState.getFullName();
        this._currentState.setCursor(0);

        // Emit the change
        if (!options.silent) {
            tmp = this._currentState;
            this._emit('change', this._currentState, this._previousState);

            // If the final state name has changed in the process, inform the user
            // This happens if the final state is changed (tipically because of default state translations)
            if (tmp === this._currentState && fullName !== this._currentState.getFullName()) {
                this._checkFinalState(fullName, this._currentState.getFullName());
            }
        }
    };

    /**
     * Checks the final state after the transition.
     * If the final state is not registered, it will be registered.
     *
     * @param {String} initialState The initial state
     * @param {String} finalState   The final state
     */
    StateRegistry.prototype._checkFinalState = function (initialState, finalState) {
        var route;

        // Abort if already registered
        if (!this._states[initialState] || this._states[finalState]) {
            has('debug') && console.info('[spoonjs] Final state after transition is "' + this._currentState.getFullName() + '".');
            return;
        }

        has('debug') && console.info('[spoonjs] Registering final state after transition, which is "' + finalState + '",');

        // Grab the route
        route = find(this._routes, function (route) {
            return route.getName() === initialState;
        }),

        // Finally add it.. note that we don't need to push
        // to the routes array because he is already there..
        this._states[finalState] = {
            route: route,
            validator: this._states[initialState].validator
        };
    };

    /**
     * Handles the address change event.
     * Note that this function returns null if the URL is the same as the previous one.
     *
     * @param {Object} obj       The address object containing the change details
     * @param {Object} [options] The options to be used
     *
     * @return {Boolean} True if it matched a registered state, false otherwise
     */
    StateRegistry.prototype._onAddressChange = function (obj, options) {
        var x,
            value = obj.newValue,
            length,
            route,
            state,
            params;

        // Ensure that the value starts with a /
        if (!startsWith(value, '/')) {
            value = '/' + value;
        }

        // Ignore if the URL is the same
        // This can happen because calls to address.setValue() from this class
        // generate a change event (internal)
        if (this._currentUrl === value) {
            return null;
        }

        this._currentUrl = value;

        // Find if there's a matching route for the new address value
        length = this._routes.length;
        for (x = 0; x < length; x += 1) {
            route = this._routes[x];

            // Test the route against the value
            if (route.test(value)) {
                // Create the state instance
                state = this._createStateInstance(route.getName(), route.match(value));
                params = state.getParams();
                params.$info = {};

                // Associate the address info to the params
                if (obj.event) {
                    obj = mixIn({}, obj);
                    delete obj.event;       // Delete the event to avoid memory leaks
                }
                params.$info.address = obj;

                // Finally change to the state
                this.setCurrent(state, options);

                return true;
            }
        }

        if (has('debug')) {
            console.warn('[spoonjs] No state matched the URL "' + value + '".');
        }

        this._emit('unknown', value);

        return false;
    };

    /**
     * Handles the click event on links.
     *
     * @param {Event} event The click event
     */
    StateRegistry.prototype._handleLinkClick = function (event) {
        var element = event.currentTarget,
            type = element.getAttribute('data-url-type'),
            url = element.href,
            state,
            params,
            pos,
            options;

        // Only parse links with state protocol
        if (startsWith(url, 'state://')) {
            event.preventDefault();

            // If the link is internal, then we just prevent default behaviour
            if (type !== 'internal') {
                // Ignore if we have interceptors running (equivalent to address is disabled)
                if (this._interceptors.running) {
                    return;
                }

                pos = url.lastIndexOf('/');
                // Extract the name and the params
                if (pos === -1) {
                    state = url.substr(8);
                } else {
                    state = url.substring(8, pos);
                    params = decode(url.substr(pos + 1));
                }

                // Extract options from attributes
                options = {
                    force: element.getAttribute('data-url-force') === 'true'
                    // No need to parse route and replace options here because they will be always false
                };

                this.setCurrent(state, params, options);
            } else if (has('debug')) {
                console.info('[spoonjs] Link poiting to state "' + state + '" is flagged as internal and as such event#preventDefault() was called on the event.');
            }
        }
    };

    /**
     * Get the URL associated to a state.
     *
     * @param {State} state The state object
     *
     * @return {String} The URL
     */
    StateRegistry.prototype._getStateUrl = function (state) {
        var registered = this._states[state.getFullName()],
            route = registered && registered.route;

        if (!route) {
            return null;
        }

        return route.generateUrl(state.getParams());
    };

    /**
     * Runs all the interceptor in series.
     * The interceptors will be reseted if the state changed.
     *
     * While the interceptors are being run, the address will be disabled.
     *
     * @param {Boolean}  run      True to run the interceptors, false otherwise
     * @param {State}    state    The state object
     * @param {Function} callback The callback to call when done
     */
    StateRegistry.prototype._handleInterceptors = function (run, state, callback) {
        var interceptors = this._interceptors,
            length,
            that = this;

        if (this._interceptors.running) {
            throw new Error('Cannot change state while running interceptors');
        }

        // Reset the interceptors the user didn't want to run them
        if (!run) {
            that._interceptors = [];
        }

        // Do not proceed if there are no interceptors
        length = interceptors.length;
        if (!length) {
            return callback(true);
        }

        function iterator(index) {
            var interceptor;

            if (index === length) {
                return done(true);
            }

            interceptor = interceptors[index];

            // Use a try to catch to handle programming errors gracefully
            try {
                interceptor.fn.call(interceptor.ctx, state, function (advance) {
                    if (advance === false) {
                        done(false);
                    } else {
                        iterator(index + 1);
                    }
                });
            } finally {
                done(false);
            }
        }

        function done(advance) {
            // Re-enable address & reset interceptors
            that._address && that._address.enable();
            that._interceptors = [];

            callback(advance);
        }

        // Disable address & mark as running
        this._address && this._address.disable();
        this._interceptors.running = true;

        iterator(0);
    };

    /**
     * Releases any listeners and resources.
     * This method is called only once after a destroy several call.
     *
     * @see StateRegistry#destroy
     */
    StateRegistry.prototype._onDestroy = function () {
        this.unregisterAll();
        this.off();

        $(document.body).off('click', 'a', this._handleLinkClick);

        this.unsetAddress();
        this._currentState = null;
    };

    return StateRegistry;
});
