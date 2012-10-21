spoon.js
========
`Indigo United 2012`


# Topics

* How an app is boostrapped
* How the development is done
    * How the user can architect everything
    * How the user can spot bugs and debug them
        * Unit testing
* What features we provide that ease the actual development (glue code)
  * How modules communicate between each other
  * Models
  * Views
  * Controllers
  * Router
* What services we provide for easing development
* How the deployment is done

--------------------------------------------------------------------------------

# Ideas

Ideas for framework:

* web intents
* service for changing application icon
* cross and intra browser communication layer, and RPC
* parameter bag with support for local storage
* proxy for APIs in http bootstrap
* support for url rewriting in http bootstrap
* watch for changes in sass files/others, and recompile automatically. Check
  [node-inotify](https://github.com/c4milo/node-inotify) for a possible solution
  or even node's
  [watch()](http://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener)
* RPC for server-side
* multiple upload component
* i18n service
  * consider using the require.js i18n plugin
* provide a live reload of css/sass files (javascript/templates hotpushes
  after?)
  * see: [http://livereload.com](http://livereload.com) and
    [http://livejs.com](http://livejs.com)
* provide something that eases developing mobile apps
* provide service for mobile location / orientation
* Easy way to create separate builds for different devices?

--------------------------------------------------------------------------------

# Bundled technologies

Technologies that will be part/integrate with the framework:

* SASS/Stylus/Less
  * Remember to suggest a community of Mixins
* SmartSprites / other
* OptiPNG / ChunkPNG / other
* Uglify / YUI Compressor / Closure
* r.js
* momentjs / other (to integrate with i18n, also update the 'x ago' once in a
  while automatically)

--------------------------------------------------------------------------------

# Featured technologies

Technologies that, although not part of the framework, we encourage people to
use, in case they need:

* Handlebars / doT
* SoundManager
* TweenMax


--------------------------------------------------------------------------------

# CLI

The CLI will help do a lot of usual tasks in the simplest way possible. Consider
enabling auto-complition for spoonjs commands. Check
[https://github.com/mklabs/node-tabtab](https://github.com/mklabs/node-tabtab)
for a possible solution.

The CLI offers the following commands:

## Framework

* spoon update --force
  * `--force` forces updating into the latest version, regardless of it being
  backwards compatible

## Project

* spoon project create
  * all the dependencies should work without the need for external installations
    such as ruby or java
* spoon project test
* spoon project run
  * http server
  * automatically watches the source folders (useful to automatically compile
    sass files)
* spoon project deploy

## Module

* spoon module create
* spoon module test

--------------------------------------------------------------------------------

# Testing

## Cross-browser Testing

* Consider integrating with [BusterJS](http://busterjs.org/)

## The Architect

* Displays overall architecture https://github.com/mbostock/d3
  * List of instanciated modules
  * Communication between modules is illustrated in the graph
  * List of non-instanciated modules
  * Gathers statistics about how many times a module is instantiated, among
    other values
  * Provides an interface that allows modules to connect to the architect, and
    add controls that allow modifying the behaviour of the module
    * Spoon.js provides a control for slowing down the whole framework, to ease
      debugging
  * The architect publishes events, and modules are able to subscribe to them

--------------------------------------------------------------------------------

# Implementation details

## Components communication

Each component (controller or view) can have children, and link to them. In
order for the children to communicate with its parent, they can upcast events,
which can then be caught by its ancestors. In case one of the ancesters catches
this event, it then handles it, and the event propagation stops. In case the
event needs to keep propagating, the handler can explicitly do so, so it doesn't
break the event chain.


## Controller

### Public Methods

* initialize/destroy
* on/off
* setState
* getState
* getBranchState

### Protected Methods

* \_link/_unlink
* _upcast: delegate an event upwards. In case no arguments are passed, the
  current event is passed, and an exception is thrown if there is no event to
  explicitly upcast
* _broadcast
* _onDestroy


## View

* The view system will provide a façade to the DOM responder.
* The DOM Responder façade will only provide access to a few methods of the
  Responder
* The view explicitly declares which events it is interested in being notified
  through an object composed of pseudo-selectors, and respective handlers
* The DOM Responder façade can also be used to manipulate listeners during
  the life cycle of the view


### Public Methods

* initialize/destroy
* on/off
* render
* clear
* appendTo
* listen/unlisten

### Protected Methods

* \_link/_unlink
* _upcast: delegate an event upwards. In case no arguments are passed, the
  current event is passed, and an exception is thrown if there is no event to
  explicitly upcast
* _broadcast
* _onDestroy

### Protected Properties

* \_dom.on/off: the _dom object can be used to add additional listeners on the
  DOM



## State Management

* Controllers can have states, identified by alpha-numeric strings
* States can be used to control the controller behaviour
* States can have routing patterns associated, that can be used to generate and
  match URLs with states
* These patterns can contain placeholders, using the format
  `{placeholder name}`, which are automatically filled by the router.
* Pattern placeholders can have validators, giving additional control over the
  matching process
* The state specification file must be used to specify patterns for the routes
* Since there is an hierarchy of controllers, states also have an hierarchy,
  which is composed of state identifiers separated by periods, allowing the user
  to reference an inner state, like so: `shop.view`. In this example, there is a
  `shop` state that is handled by the `ApplicationController`, which
  instantiates, if necessary, the `ShopController`, and pushes the remainder of
  the state, in this case `view`. This state is then handled by the
  `ShopController`
* Each time a state gets pushed into a controller that is not capable of
  handling that specific state, the remainder is rebuilt, state by state, until
  there is a state the controller is able to handle, and a warning is issued if
  no state is found suitable. This is useful to avoid having stateless
  controllers explicitly forwarding state
* The pattern definition can be omitted when the pattern is equal to the state
  identifier itself. In these cases, the identifier is used as the pattern.
  Check the `shop.buy` example below. In this case, both the `shop` and `buy`
  patterns could have been omitted
* When declaring leaf states, there is no need to use an object for the pattern.
  The user can specify the pattern directly. In case the user wants to use the
  identifier as the pattern, `null` should be used as the pattern (check the
  `library.share` example below)
* An object is used to advertise the controller states and respective handlers
* The handlers are responsible for setting up anything necessary for the route
  that was requested, including instantiating sub controllers.
* After the handler has performed everything necessary for the sub controller to
  continue the route handling, it must notify the sub controller to do so,
  giving the programmer full control over the chain of responsibilities
* Helper functions can be injected into templates, in order to help the
  generation of URLs. Check the template example below.

```javascript
{
    shop: {
        $pattern: '/shop',
        index: '/',
        view: '/{id}'
        buy: '/buy'
    },
    library: {
        $pattern: '/library',
        view: {
            $pattern: '/{id}',
            $validators: {
                id: /\d+
            }
        },
        share: null
    }
};
```

```HTML
<a {{ $url('shops.view', { id: 2 }) }} class="some_class">
  {{ $url('shops.view', { id: 2 }) }}
</a>
```

Note that state management can work without routes. When the `href` helper is
called, it generates an `href` HTML attribute, and possibly a `data-state`, in
case the state does not possess a pattern by itself. In such case, the `href` is
set to `#`, and the `data-state` is set with an escaped string of the state
identifier and arguments. This `data-state` will be read when the user clicks
the link, and used to change the application state.