/*global describe, it*/

define([
    'expect',
    'spoon'
], function (expect, spoon) {

    'use strict';

    describe('core', function () {
        it('should be an object exposing the core', function () {
            expect(spoon).to.be.an('object');
            expect(spoon.Controller).to.be.a('function');
            expect(spoon.View).to.be.a('function');
        });
    });
});