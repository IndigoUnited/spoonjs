/**
 * Broadcaster factory.
 * This class provides access to the broadcaster as a service.
 */
define([
    'spoon/core/Broadcaster/Broadcaster'
], function (Broadcaster) {

    'use strict';

    return new Broadcaster();
});