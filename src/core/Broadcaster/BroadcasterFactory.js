/**
 * Broadcaster factory.
 * This class provides access to the broadcaster as a service.
 */
define([
    './Broadcaster'
], function (Broadcaster) {

    'use strict';

    return new Broadcaster();
});
