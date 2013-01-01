/*jshint unused:false*/

/**
 * Broadcaster interface.
 */
define([
    'dejavu/Interface',
    'events-emitter/SubscribeInterface'
], function (Interface, SubscribeInterface) {

    'use strict';

    return Interface.declare({
        $name: 'BroadcasterInterface',
        $extends: SubscribeInterface,

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