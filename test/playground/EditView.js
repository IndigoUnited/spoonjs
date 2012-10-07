define(['spoon', 'handlebars'], function (spoon, Handlebars) {
    'use strict';

    return spoon.View.extend({
        $name: 'EditView',

        _template: Handlebars.compile('<div class="edit"><input value="{{ name }}" /><button>Save</button></div>'),
        _events: {
            'click button': '_onSaveClick'
        },

        initialize: function ($element) {
            this.$super($element);
        },

        render: function (data) {
            this.$super(data);

            console.log(this._element, data);
            var el = this._element.find('input');
        },

        /////////////////////////////////////////////////////////////////////////

        _onSaveClick: function (event, element) {
            this._upcast('save');
        }
    });
});