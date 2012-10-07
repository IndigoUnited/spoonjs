/*jshint unused:false*/

/**
 * Broadcaster interface.
 */
define([
    'dejavu/Interface'
], function (Interface) {

    'use strict';

    return Interface.declare({
        $name: 'BroadcasterInterface',

        /**
         * Adds a broadcast event listener.
         * If the listener is already attached, it won't get duplicated.
         *
         * @param {String}   event      The event name
         * @param {Function} fn         The listener
         * @param {Object}   [$context] The context in which the function will be executed, defaults to the instance
         *
         * @return {BroadcasterInterface} The instance itself to allow chaining
         */
        on: function (event, fn, $context) {},

        /**
         * Removes an existent broadcast event listener.
         * If no fn and context is passed, removes all event listeners of a given name.
         * If no event is specified, removes all events of all names.
         *
         * @param {String}   [$event]   The event name
         * @param {Function} [$fn]      The listener
         * @param {Object}   [$context] The context passed to the on() function
         *
         * @return {BroadcasterInterface} The instance itself to allow chaining
         */
        off: function ($event, $fn, $context) {},

         /**
         * Emits a broadcast event.
         *
         * @param {String}   event   The event name
         * @param {...mixed} [$args] The arguments to pass to each listener
         *
         * @return {BroadcasterInterface} The instance itself to allow chaining
         */
        broadcast: function (event, $args) {}
    });
});