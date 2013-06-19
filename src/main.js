/**
 * Module that returns an object exposing the core.
 */
define([
    './core/Controller',
    './core/View',
    './util/console'
], function (Controller, View) {

    'use strict';

    return {
        Controller: Controller,
        View: View
    };
});