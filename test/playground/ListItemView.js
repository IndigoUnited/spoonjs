define(['spoon', 'handlebars', 'jquery'], function (spoon, Handlebars, $) {
    'use strict';

    return spoon.View.extend({
        $name: 'ListItemView',

        _template: Handlebars.compile('<span class="title">item {{ id }}</span> | </span class="actions"><span class="edit">edit</span> <span class="delete">delete</span></span>'),
        _events: {
            'click .edit': '_onEditClick',
            'click .delete': '_onDeleteClick'
        },

        _data: null,

        initialize: function () {
            var el = $('<li></li>');

            this.$super(el);
        },

        name: function () {
            return this._element.find('.title').html();
        },

        /////////////////////////////////////////////////////////////////////////

        _onDeleteClick: function (event, element) {
            this._upcast('delete', this._element.parent().children().index(this._element));
        },

        _onEditClick: function (event, element) {
            this._upcast('edit', this._element.parent().children().index(this._element));
        }
    });
});