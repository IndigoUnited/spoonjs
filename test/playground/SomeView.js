define(['spoon', 'handlebars', 'jquery'], function (spoon, Handlebars) {

    'use strict';

    return spoon.View.extend({
        $name: 'SomeView',

        _template: Handlebars.compile('<ul><li><a href="{{url "show" id=1}}">{{ hello }}</a></li><li><a href="{{url "index"}}">{{ world }}</a></li></ul>'),
        _events: {
            'click li':   '_onClick',
            'mouseenter': '_onMouseEnter',
            'mouseleave': '_onMouseLeave'
        },

        /////////////////////////////////////////////////////////////////////////

        _onClick: function (event, element) {
            console.log('clicked!', event, element);
        },

        _onMouseEnter: function (event, element) {
            console.log('enter!', event, element);
        },

        _onMouseLeave: function (event, element) {
            console.log('leave!', event, element);
        }
    });
});