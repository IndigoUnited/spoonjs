/**
 * Broadcaster class.
 */
define([
    'dejavu/Class',
    './BroadcasterInterface',
    'events-emitter/EventsEmitter',
    'has'
], function (Class, BroadcasterInterface, EventsEmitter, has) {

    'use strict';

    // It is just a simple façade to a single EventsEmitter
    var Broadcaster = Class.declare({
        $name: 'Broadcaster',
        $implements: BroadcasterInterface,

        _emitter: null,

        /**
         * Constructor.
         */
        initialize: function () {
            this._emitter = new EventsEmitter();
        },

        /**
         * {@inheritDoc}
         */
        on: function (event, fn, $context) {
            this._emitter.on(event, fn, $context);

            return this;
        },

        /**
         * {@inheritDoc}
         */
        off: function ($event, $fn, $context) {
            this._emitter.off($event, $fn, $context);

            return this;
        },

        /**
         * {@inheritDoc}
         */
        broadcast: function (event, $args) {
            // If we got no interested subjects, warn that this event was unhandled
            if (this._emitter.has(event)) {
                this._emitter.emit.apply(this._emitter, arguments);
            } else if (has('debug')) {
                console.warn('Unhandled broadcast event "' + event + '".');
            }

            return this;
        }
    });

    return Broadcaster;
});