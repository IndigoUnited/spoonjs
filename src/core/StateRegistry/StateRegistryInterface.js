 /*jshint unused:false*/

/**
 * StateRegistry interface.
 */
define([
    'dejavu/Interface',
    'events-emitter/SubscribeInterface'
], function (Interface, SubscribeInterface) {

    'use strict';

    return Interface.declare({
        $name: 'StateRegistryInterface',
        $extends: SubscribeInterface,

        $constants: {
            EVENT_CHANGE: 'change'
        },

        /**
         * Sets the address.
         *
         * @param {AddressInterface} [$address] The address to set or null to unset it
         *
         * @return {StateRegistryInterface} The instance itself to allow chaining
         */
        setAddress: function ($address) {},

        /**
         * Unsets the address.
         *
         * @return {StateRegistryInterface} The instance itself to allow chaining
         */
        unsetAddress: function () {},

        /**
         * Parses a given route.
         * If no route is passed, the current address value is used.
         * If a state is found for the route and is different from the current one, a transition
         * will occur and the change event will be emitted.
         *
         * This function is handy to kick-off the state registry.
         *
         * @param {String} [$route] The route (URL fragment)
         *
         * @return {StateRegistryInterface} The instance itself to allow chaining
         */
        parse: function ($route) {},

        /**
         * Registers a map between a state and a route.
         * The pattern can have placeholders which will be used to fill a parameters object.
         * The constraints object is a simple key value object in which the keys are the placeholder names and the values are regular expressions.
         * An error will be thrown if the state being registered already exists.
         *
         * @param {String} state          The state
         * @param {String} [$pattern]     The route pattern
         * @param {Object} [$constraints] The route contraints
         *
         * @return {StateRegistryInterface} The instance itself to allow chaining
         */
        register: function (state, $pattern, $constraints) {},

        /**
         * Unregisters a state.
         *
         * @param {String} state The state
         *
         * @return {StateRegistryInterface} The instance itself to allow chaining
         */
        unregister: function (state) {},

        /**
         * Unregisters all the registered states.
         *
         * @return {StateRegistryInterface} The instance itself to allow chaining
         */
        unregisterAll: function () {},

        /**
         * Checks if a state is registered.
         *
         * @param {String} state The state
         *
         * @return {Boolean} True if it is, false otherwise
         */
        isRegistered: function (state) {},

        /**
         * Checks if state is registered and has a route associated to it.
         *
         * @param {String} state The state
         *
         * @return {Boolean} True if it is, false otherwise
         */
        isRoutable: function (state) {},

        /**
         * Checks if a given state name is valid.
         *
         * @param {String} state The state
         *
         * @return {Boolean} True if valid, false otherwise
         */
        isValid: function (state) {},

        /**
         * Sets the current state.
         * If the state is not the same, the change event will be emited.
         * Also if the state has a route associated and the routing is enabled, the browser URL will be updated accordingly.
         *
         * @param {String|StateInterface} state     The state name or the state object
         * @param {Object}                [$params] The state parameters if the state was a string
         *
         * @return {Boolean} True if the transition was made, false otherwise
         */
        setCurrent: function (state, $params) {},

        /**
         * Returns the current state.
         *
         * @return {StateInterface} The state
         */
        getCurrent: function () {},

        /**
         * Check if the current state is the same as the passed one.
         *
         * @param {String|StateInterface} state     The state name or the state object
         * @param {Object}                [$params] The state parameters if the state was a string
         *
         * @return {Boolean} True if it is, false otherwise
         */
        isCurrent: function (state) {},

        /**
         * Generates an URL for a given state.
         * If no route is associated with the state, a state:// URL will be generated.
         *
         * @param {String|StateInterface} state       The state name or the state object
         * @param {Object}                [$params]   The state parameters if the state was a string
         * @param {Boolean}               [$absolute] True to only generate an absolute URL, false otherwise
         *
         * @return {String} The URL for the state or null if unable to generate one
         */
        generateUrl: function (state, $params, $absolute) {},

        /**
         * Destroys the instance.
         */
        destroy: function () {}
    });
});