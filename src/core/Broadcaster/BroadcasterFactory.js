/**
 * Broadcaster factory.
 * This class provides access to the broadcaster as a service.
 */
define([
    'spoon/core/broadcaster/Broadcaster'
], function (Broadcaster) {

    'use strict';

    return new Broadcaster();
});