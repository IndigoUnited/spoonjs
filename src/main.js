/**
 * Module that returns an object exposing the core.
 */
define([
    './core/Controller',
    './core/View',
    './core/BaseView',
    './util/console'
], function (Controller, View, BaseView) {

    'use strict';

    return {
        Controller: Controller,
        View: View,
        BaseView: BaseView
    };
});