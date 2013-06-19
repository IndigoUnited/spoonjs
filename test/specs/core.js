define([
    'spoon'
], function (spoon) {

    'use strict';

    describe('spoon', function () {
        it('should be an object exposing the core', function () {
            expect(spoon).to.be.an('object');
            expect(spoon.Controller).to.be.a('function');
            expect(spoon.View).to.be.a('function');
            expect(spoon.BaseView).to.be.a('function');
        });
    });
});