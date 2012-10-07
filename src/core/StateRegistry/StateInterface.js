/*jshint unused:false*/

/**
 * State interface.
 */
define(['dejavu/Interface'], function (Interface) {

    'use strict';

    return Interface.declare({
        $name: 'StateInterface',

        /**
         * Get the state name (the name imediatly after the current cursor position).
         *
         * @return {String} The name
         */
        getName: function () {},

        /**
         * Get the current state name, including the branch (complete name after the current cursor position).
         * Returns null if none is set.
         *
         * @return {String} The branch state name
         */
        getBranchName: function () {},

        /**
         * Get the full state name.
         *
         * @return {String} The full state name
         */
        getFullName: function () {},

        /**
         * Get the state parameters.
         *
         * @return {Object} The state parameters
         */
        getParams: function () {},

        /**
         * Advance the cursor position.
         * Note that the cursor is allowed to move forward to the last position, so that getName() returns null.
         *
         * @return {StateInterface} The instance itself to allow chaining
         */
        next: function () {},

        /**
         * Recede the cursor position.
         *
         * @return {StateInterface} The instance itself to allow chaining
         */
        previous: function () {},

        /**
         * Get the current cursor position.
         *
         * @return {Number} The cursor position
         */
        getCursor: function () {},

        /**
         * Sets the current cursor position.
         *
         * @param {Number} The new position
         */
        setCursor: function (cursor) {},

        /**
         * Compares the instance to another one.
         * The state is considered to the same if the name is equal and its params are equal.
         *
         * @param {StateInterface} state         The state
         * @param {Array}          [$paramNames] An array of param names to be compared
         *
         * @return {Boolean} True if the state is the same, false otherwise
         */
        isEqual: function (state, $paramNames) {},

        /**
         * Compares the instance to another one.
         * The state is considered to be fully equal if the full state name and the parameters are the same.
         *
         * @param {StateInterface} state The state
         *
         * @return {Boolean} True if the state is fully equal
         */
        isFullyEqual: function (state) {}
    });
});