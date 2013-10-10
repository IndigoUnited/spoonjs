/**
 * StateRegistry class.
 */
define([
    'events-emitter/MixableEventsEmitter',
    './State',
    './Route',
    'mout/array/remove',
    'mout/object/hasOwn',
    'mout/object/mixIn',
    'mout/string/startsWith',
    'mout/queryString/decode',
    'mout/queryString/encode',
    'has',
    'jquery'
], function (MixableEventsEmitter, State, Route, remove, hasOwn, mixIn, startsWith, decode, encode, has, $) {

    'use strict';

    /**
     * Constructor.
     */
    function StateRegistry() {
        this._states = {};
        this._routes = [];
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
            address.on('change', this._onChange, this);
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
            this._address.off('change', this._onChange, this);
            this._address = null;
            this._currentUrl = null;
        }
    };

    /**
     * Parses a given route.
     * If no route is passed, the current address value is used.
     * If a state is found for the route and is different from the current one, a transition
     * will occur and the change event will be emitted.
     *
     * This function is handy to kick-off the state registry.
     *
     * @param {String} [route] The route (URL fragment)
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.parse = function (route) {
        // Manually call the change handler with the passed route
        // or the address value (if available)
        var obj = {
            newValue: route != null ? route : (this._address ? this._address.getValue() : ''),
            oldValue: null,
            type: 'external'
        };

        this._onChange(obj);

        return this;
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
     * If the state is not the same, the change event will be emited.
     * Also if the state has a route associated and the routing is enabled, the browser URL will be updated accordingly.
     *
     * The default implementation should handle these options:
     *  - force:   true to force the value to be changed even if the value is the same
     *  - route:   false to not change the address value
     *  - replace: true to replace the address value instead of adding a new history entry
     *
     * @param {String|State} state     The state name or the state object
     * @param {Object}       [params]  The state parameters if the state was a string
     * @param {Object}       [options] The options
     *
     * @return {Boolean} True if the transition was made, false otherwise
     */
    StateRegistry.prototype.setCurrent = function (state, params, options) {
        var previousState;

        // Handle args
        if (typeof state === 'string') {
            state = this._createStateInstance(state, params);
        } else {
            options = params;
        }

        // Set default options and merge them with the user ones
        options = mixIn({
            route: true,
            replace: !this._currentState  // Replace URL if it's the first state
        }, options || {});

        // Only change if the current state is not the same
        if (!this.isCurrent(state) || options.force) {
            previousState = this._currentState;
            this._currentState = state;

            // Handle after change stuff
            this._postChangeHandler(previousState, options);

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
        var route = this._states[state],
            url;

        if (!route || !this._address) {
            return 'state://' + state + '/' + encode(params);
        }

        url = route.generateUrl(params);

        return this._address ? this._address.generateUrl(url, absolute) : url;
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
            url,
            route,
            tmp,
            fullName;

        if (has('debug')) {
            console.info('State changed to "' + state + '".');
            if (!this.isRegistered(state)) {
                console.warn('State "' + state + '" is not registered.');
            }
        }

        params.$info = params.$info || {};
        params.$info.newState = this._currentState;
        params.$info.previousState = previousState;

        // Set address value
        if (this._address && options.route) {
            route = this._states[state];
            if (!route) {
                this._address.reset();
                this._currentUrl = null;
            } else {
                url = route.generateUrl(params);
                this._address.setValue(url, options);
            }
        }

        fullName = this._currentState.getFullName();
        this._currentState.setCursor(0);

        // Emit the change
        tmp = this._currentState;
        this._emit('change', this._currentState, previousState);

        // If the final state name has changed in the process, inform the user
        // This happens if the final state is changed (tipically because of default state translations)
        if (has('debug') && tmp === this._currentState && fullName !== this._currentState.getFullName()) {
            console.info('Final state after transition is "' + this._currentState.getFullName() + '".');
        }
    };

    /**
     * Handles the address change event.
     *
     * @param {Object} obj The address object containing the change details
     */
    StateRegistry.prototype._onChange = function (obj) {
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
            return;
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
                this.setCurrent(state);
                return;
            }
        }

        if (has('debug')) {
            console.warn('No state matched the URL "' + value + '".');
        }
    };

    /**
     * Handles the click event on links.
     *
     * @param {Event}   event The click event
     * @param {Element} [el]  The link tag
     */
    StateRegistry.prototype._handleLinkClick = function (event, el) {
        var element = el || event.currentTarget,
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
                console.info('Link poiting to state "' + state + '" is flagged as internal and as such event#preventDefault() was called on the event.');
            }
        }
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
