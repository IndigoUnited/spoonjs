define(['spoon', './ListItemView', './EditView', 'handlebars', 'jquery'], function (spoon, ListItemView, EditView, Handlebars, $) {
    'use strict';

    return spoon.View.extend({
        $name: 'ListView',

        _template: Handlebars.compile('<div class="list"><ul></ul></div>'),
        _events: {
            'mouseenter': '_onMouseEnter',
            'mouseleave': '_onMouseLeave'
        },

        _items: [],

        initialize: function ($element) {
            this.$super($element);

            this.on('delete', this.remove);
            this.on('edit', this.edit);
            this.on('save', this.save);
        },

        remove: function (index) {
            var view = this._items[index];
            view.destroy();

            this._items.splice(index, 1);
        },

        edit: function (index) {
            var view = this._items[index],
                edit;

            edit = this._link(new EditView($('.list')));
            console.log(view.name());
            edit.render({ name: view.name() });
        },

        save: function () {
            this.render();
        },

        render: function () {
            this.$super();

            var ul = this._element.find('ul'),
                x,
                view;

            for (x = 1; x < 6; x += 1) {
                view = this._link(new ListItemView());
                view.render({ id: x });
                ul.append(view.getElement());
                this._items.push(view);
            }
        },

        clear: function () {
            var x,
                view;

            for (x = this._items.length - 1; x >= 0; x -= 1) {
                view =  this._items[x];
                view.destroy();
            }

            this._items = [];

            this.$super();
        },

        /////////////////////////////////////////////////////////////////////////

        _onMouseEnter: function (event, element) {
            console.log('mouse enter!');
        },

        _onMouseLeave: function (event, element) {
            console.log('mouse leave!');
        }
    });
});