/**
 * Module that returns an object exposing the framework.
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