/*jshint loopfunc:true*/

/**
 * StateRegistry class.
 */
define([
    'events-emitter/MixableEventsEmitter',
    './State',
    './Route',
    'mout/array/findIndex',
    'mout/array/remove',
    'mout/object/hasOwn',
    'mout/object/mixIn',
    'mout/string/startsWith',
    'mout/queryString/decode',
    'mout/queryString/encode',
    'has',
    'jquery'
], function (MixableEventsEmitter, State, Route, findIndex, remove, hasOwn, mixIn, startsWith, decode, encode, has, $) {

    'use strict';

    /**
     * Constructor.
     */
    function StateRegistry() {
        this._states = {};
        this._routes = [];
        this._interceptors = [];
        this._destroyed = false;

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
     * Registers a map between a state and a route.
     * The pattern can have placeholders which will be used to fill a parameters object.
     * The constraints object is a simple key value object in which the keys are the placeholder names and the values are regular expressions.
     * An error will be thrown if the state being registered already exists.
     *
     * @param {String} state         The state
     * @param {String} [pattern]     The route pattern
     * @param {Object} [constraints] The route contraints
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.register = function (state, pattern, constraints) {
        if (has('debug') && this._states[state]) {
            throw new Error('State "' + state + '" is already registered.');
        }

        var route = pattern != null ? new Route(state, pattern, constraints) : null;

        // Add to the states object
        this._states[state] = route;

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
        var route = this._states[state];

        // Remove it from the states object
        delete this._states[state];

        if (route) {
            // Remote it from the routes array
            remove(this._routes, route);
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
        return !!this._states[state];
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
     *  - force:   true to force the value to be changed even if the value is the same
     *  - route:   false to not change the address value
     *  - replace: true to replace the address value instead of adding a new history entry
     *  - silent:  true to silently change the state, without emitting an event
     *
     * @param {String|State} state     The state name or the state object
     * @param {Object}       [params]  The state parameters if the state was a string
     * @param {Object}       [options] The options
     *
     * @return {Boolean} True if the transition will be made, false otherwise
     */
    StateRegistry.prototype.setCurrent = function (state, params, options) {
        var previousState,
            that = this;

        // Handle args
        if (typeof state === 'string') {
            state = this._createStateInstance(state, params);
        } else {
            options = params;
        }

        // Set default options and merge them with the user ones
        options = mixIn({
            route: true,
            replace: !this._currentState,  // Replace URL if it's the first state
            interceptors: true
        }, options || {});

        // Only change if the current state is not the same
        if (!this.isCurrent(state) || options.force) {
            this._executeInterceptors(!options.interceptors, function (advance) {
                if (!advance) {
                    that._emit('cancel', state);
                } else {
                    previousState = that._currentState;
                    that._currentState = state;

                    // Handle after change stuff
                    that._postChangeHandler(previousState, options);
                }
            });
            return true;
        }

        return false;
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
        var route,
            url;

        if (typeof state !== 'string') {
            state = state.getFullName();
        }

        route = this._states[state];
        if (!route || !this._address) {
            params = State.filterSpecial(params);
            return 'state://' + state + '/' + encode(params);
        }

        url = route.generateUrl(params);

        return this._address ? this._address.generateUrl(url, absolute) : url;
    };

    /**
     * Configures a interceptor that will be run before actually changing the state.
     * This easily allows use cases such as "are you sure you want to quit".
     *
     * @param {Function} fn  The interceptor
     * @param {Object}   ctx The context
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.addInterceptor = function (fn, ctx) {
        this.removeInterceptor(fn, ctx);
        this._interceptors.push({ fn: fn, ctx: ctx });

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
        var index = findIndex(this._interceptors, function (obj) {
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
     * @param {State}  previousState The previous state
     * @param {Object} options       The options
     */
    StateRegistry.prototype._postChangeHandler = function (previousState, options) {
        var state = this._currentState.getFullName(),
            params = this._currentState.getParams(),
            route,
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
        params.$info.previousState = previousState;

        // Set address value
        if (this._address && options.route) {
            route = this._states[state];
            if (route) {
                this._currentUrl = route.generateUrl(params);
                this._address.setValue(this._currentUrl, options);
            }
        }

        fullName = this._currentState.getFullName();
        this._currentState.setCursor(0);

        // Emit the change
        if (!options.silent) {
            tmp = this._currentState;
            this._emit('change', this._currentState, previousState);

            // If the final state name has changed in the process, inform the user
            // This happens if the final state is changed (tipically because of default state translations)
            if (has('debug') && tmp === this._currentState && fullName !== this._currentState.getFullName()) {
                console.info('[spoonjs] Final state after transition is "' + this._currentState.getFullName() + '".');
            }
        }
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

                // Restore the old address value if any interceptor canceled
                // the state transition
                if (this._address) {
                    this.on('cancel.state_registry_address', function () {
                        this.off('.state_registry_address');
                        this._address && this._address.setValue(obj.oldValue, { silent: true });
                    }, this);
                    this.on('change.state_registry_address', function () {
                        this.off('.state_registry_address');
                    }, this);
                }

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
     * Runs all the intercepts in series.
     * If the state changed between, the process will be aborted.
     *
     * The intercepts will be reseted if the state changed.
     *
     * @param {Boolean}  skip     True to skip the functions themselves
     * @param {State}    state    The state object
     * @param {Function} callback The callback to call when done
     */
    StateRegistry.prototype._executeInterceptors = function (skip, state, callback) {
        var interceptors = this._interceptors,
            length = interceptors.length,
            that = this;

        if (has('debug') && this._interceptors.running) {
            throw new Error('Cannot change state while running interceptors');
        }

        // Do not proceed if there are no interceptors
        if (!length) {
            return callback(true);
        }

        if (skip) {
            that._interceptors = [];
            return callback(true);
        }

        function iterator(index) {
            var interceptor;

            if (index === length) {
                // Re-enable address & reset interceptors
                that._address && that._address.enable();
                that._interceptors = [];

                return callback(true);
            }

            interceptor = interceptors[index];
            interceptor.fn.call(interceptor.ctx, state, function (advance) {
                if (advance === false) {
                    that._address && that._address.enable();
                    that._interceptors.running = false;

                    return callback(false);
                }

                iterator(index + 1);
            });
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
        this._currentState = this._currenUrl = null;
    };

    return StateRegistry;
});
