/**
 * StateRegistry class.
 */
define([
    'dejavu/Class',
    'dejavu/instanceOf',
    './StateRegistryInterface',
    'events-emitter/MixableEventsEmitter',
    'address/AddressInterface',
    './StateInterface',
    './State',
    './Route',
    'base-adapter/dom/Events',
    'mout/array/remove',
    'mout/object/hasOwn',
    'mout/object/mixIn',
    'mout/string/startsWith',
    'mout/queryString/decode',
    'mout/queryString/encode',
    'has'
], function (Class, instanceOf, StateRegistryInterface, MixableEventsEmitter, AddressInterface, StateInterface, State, Route, Events, remove, hasOwn, mixIn, startsWith, decode, encode, has) {

    'use strict';

    return Class.declare({
        $name: 'StateRegistry',
        $implements: StateRegistryInterface,
        $borrows: MixableEventsEmitter,

        _states: {},
        _routes: [],

        _currentState: null,
        _address: null,

        _destroyed: false,

        /**
         * Constructor.
         */
        initialize: function () {
            Events.on(document.body, 'click a', this._handleLinkClick);
        },

        /**
         * {@inheritDoc}
         */
        setAddress: function ($address) {
            this.unsetAddress();
            if ($address) {
                this._address = $address;

                // Listen to the address change
                $address.on(AddressInterface.EVENT_CHANGE, this._onChange, this);
            }

            return this;
        },

        /**
         * Unsets the address, if any.
         */
        unsetAddress: function () {
            if (this._address) {
                this._address.off(AddressInterface.EVENT_CHANGE, this._onChange, this);
                this._address = null;
            }
        },

        /**
         * {@inheritDoc}
         */
        parse: function ($route) {
            // Manually call the change handler with the passed route
            // or the address value (if available)
            var obj = {
                newValue: $route != null ? $route : (this._address ? this._address.getValue() : ''),
                oldValue: null,
                type: AddressInterface.TYPE_EXTERNAL_CHANGE
            };

            this._onChange(obj);

            return this;
        },

        /**
         * {@inheritDoc}
         */
        register: function (state, $pattern, $constraints) {
            if (has('debug') && this._states[state]) {
                throw new Error('State "' + state + '" is already registered.');
            }

            var route = $pattern != null ? new Route(state, $pattern, $constraints) : null;

            // Add to the states object
            this._states[state] = route;

            // Add to the routes array
            if (route) {
                this._routes.push(route);
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        unregister: function (state) {
            var route = this._states[state];

            // Remove it from the states object
            delete this._states[state];

            if (route) {
                // Remote if from the routes array
                remove(this._routes, route);
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        unregisterAll: function () {
            this._states = {};
            this._routes = [];

            return this;
        },

        /**
         * {@inheritDoc}
         */
        isRegistered: function (state) {
            return hasOwn(this._states, state);
        },

        /**
         * {@inheritDoc}
         */
        isRoutable: function (state) {
            return !!this._states[state];
        },

        /**
         * {@inheritDoc}
         */
        isValid: function (name) {
            return State.isValid(name);
        },

        /**
         * {@inheritDoc}
         */
        setCurrent: function (state, $params, $options) {
            var previousState;

            // Handle args
            if (!instanceOf(state, StateInterface)) {
                state = this._createStateInstance(state, $params);
            } else {
                $options = $params;
            }

            // Set defaul options and merge them with the user ones
            $options = mixIn({ route: true }, $options || {});

            // Only change if the current state is not the same
            if (!this.isCurrent(state) || $options.force) {
                previousState = this._currentState;
                this._currentState = state;

                // Handle after change stuff
                this._postChangeHandler(previousState, $options);

                return true;
            }

            return false;
        },

        /**
         * {@inheritDoc}
         */
        getCurrent: function () {
            return this._currentState;
        },

        /**
         * {@inheritDoc}
         */
        isCurrent: function (state, $params) {
            // If no state is set simply return false
            if (!this._currentState) {
                return false;
            }

            // Build the state object
            if (!instanceOf(state, StateInterface)) {
                state = this._createStateInstance(state, $params);
            }

            return this._currentState.isFullyEqual(state);
        },

        /**
         * {@inheritDoc}
         */
        generateUrl: function (state, $params, $absolute) {
            var route = this._states[state],
                url;

            if (!route || !this._address) {
                return 'state://' + state + '/' + encode($params);
            }

            url = route.generateUrl($params);

            return this._address ? this._address.generateUrl(url, $absolute) : url;
        },

        /**
         * {@inheritDoc}
         */
        destroy: function () {
            if (!this._destroyed) {
                this._onDestroy();
                this._destroyed = true;
            }
        },

        ///////////////////////////////////////////////////////////////

        /**
         * Creates a new state instance.
         *
         * @param {String} state     The state name
         * @param {Object} [$params] The state parameters if the state was a string
         *
         * @return {StateInterface} The state instance
         */
        _createStateInstance: function (state, $params) {
            return new State(state, $params);
        },

        /**
         * Handles stuff after the state has changed.
         *
         * @param {StateInterface} previousState The previous state
         * @param {Object}         options       The options
         */
        _postChangeHandler: function (previousState, options) {
            var state = this._currentState.getFullName(),
                params = this._currentState.getParams(),
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
                } else {
                    this._address.setValue(route.generateUrl(params), options);
                }
            }

            this._currentState.setCursor(0);

            // Emit the change
            if (!options.silent) {
                tmp = this._currentState;
                this._emit(this.$static.EVENT_CHANGE, this._currentState, previousState);

                // If the final state name has changed in the process, inform the user
                // This happens if the final state is changed (tipically because of default state translations)
                fullName = this._currentState.getFullName();
                if (has('debug') && tmp === this._currentState && fullName !== this._currentState.getFullName()) {
                    console.info('Final state after transition is "' + this._currentState.getFullName() + '".');
                }
            }
        },

        /**
         * Handles the address change event.
         *
         * @param {Object} obj The address object containing the change details
         */
        _onChange: function (obj) {
            var x,
                value = obj.newValue,
                length,
                route,
                state,
                params;

            // If the type of change is internal, match against the current state/route
            // If it's the same ignore, otherwise someone changed the value directly in the address instance
            if (obj.type === AddressInterface.TYPE_INTERNAL_CHANGE && this._currentState) {
                route = this._states[this._currentState.getFullName()];
                if (route && route.test(value)) {
                    this._currentState.getParams().$info.address = obj;
                    return;
                }
            }

            // Find if there's a matching route for the new address value
            // Ensure that the value starts with a /
            value = value || '/';
            if (value.charAt(0) !== '/') {
                value = '/' + value;
            }

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
        },

        /**
         * Handles the click event on links.
         *
         * @param {Event}   event The click event
         * @param {Element} [$el] The link tag
         */
        _handleLinkClick: function (event, $el) {
            var element = $el || Events.getCurrentTarget(event),
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
                        force: !!element.getAttribute('data-url-force'),
                        silent: !!element.getAttribute('data-url-silent')
                    };

                    this.setCurrent(state, params, options);
                } else if (has('debug')) {
                    console.info('Link poiting to state "' + state + '" is flagged as internal and as such event#preventDefault() was called on the event.');
                }
            }
        }.$bound(),

        /**
         * Releases any listeners and resources.
         * This method is called only once after a destroy several call.
         *
         * @see StateRegistry#destroy
         */
        _onDestroy: function () {
            this.unregisterAll();
            this.off();

            Events.off(document.body, 'click a', this._handleLinkClick);

            this.unsetAddress();
            this._currentState = null;
        }
    });
});