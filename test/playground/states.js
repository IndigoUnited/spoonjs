define(function () {

    'use strict';

    return {
        shop: {
            $pattern: '/shop',
            index: '/',
            show: {
                $pattern: '/{id}',
                $constraints: {
                    id: /\d+/
                },
                $priority: 1
            }
        },
        friends: {
            $pattern: '/friends',
            index: '/',
            requests: '/requests'
        }
    };
});