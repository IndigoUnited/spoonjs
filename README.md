spoon.js
========
`Indigo United 2012`

[indigounited.com](http://indigounited.com/)


## Motivation

Even though frontend development has come a long way, and there are some good solutions out there, there are two main approaches:

1. Go "light", use a thin framework, that gives you a lot of flexibility, but ultimately leaves you responsible for some tedious, repetitive, and complex tasks.

2. Go "enterprise", use some solution that gives you a lot with no effort, and find yourself fighting the framework, trying to customise something.

Not being happy with this, and taking advantage of our experience, we set out to build a framework that would solve these issues, and a few more that were bugging us. The main drive of the framework is to help developers build solid applications faster, without that bitter-sweet feeling the development simplicity will eventually turn into a nightmare of unmaintainable code due to undocumented framework compromises or even bad options by the developer.

So, without getting too deep in the details, what makes Spoon.js a 3rd option?

It's an HMVC framework, the "H" stands for hierarchical. Unlike other frameworks, that organise the files depending on the file extension, Spoon.js structures the project semantically, in terms of what feature the module accomplishes in the application. What this means is that the project is composed of modules, and the modularity can be seen both in the implementation, and project organisation.




## Concept

### HMVC



### Modular projects (the H in HMVC)

Most frameworks out there organise projects in terms of file extension and, although simple, it makes it hard to have reusable components, and maintain big projects. This is one aspect in which Spoon.js stands out, organising the project files in a feature oriented fashion.

Please check below a typical project file structure (note that a few files are omitted for simplicity, like favicon files, among others).

```
app/
    bootstrap.js     // the script that boots the application. This file is included the index.html file
    grunt.js         // the grunt config file for building the project. You can edit this file and customise the building process
    config.js        // project configurations
    config_dev.js    // you can have separate configurations for separate environments. In order to use different configs, would load a different file in the index.html file
    config_prod.js
    states.js        // state and routing configuration
components/          // external dependencies
    …
src/                 // this is where your application code lives
    Application/     // the main module
        assets/      // this is the ideal place for placing CSS files, images, templates, or anything else you feel appropriate
                     // note that each module has its own assets folder. When deciding where to put a specific asset, you should try to put it in a common ancestor of all the modules that use that asset. If an asset is used project-wide, you should probably place it in the Application assets.
            css/
            img/
            tmpl/
        ApplicationController.js        // the root controller (can be changed in the bootstrap file)
        ApplicationView.js
        Content/                        // this folder only has modules within it, but it not a module by itself. You can create these folders if it helps you organise the project
            Articles/
                assets/
                    css/
                    img/
                    tmpl/
                ArticleDetailsView.js
                ArticleListItemView.js
                ArticlesController.js
                ArticlesListView.js
            Help/
                assets/
                    css/
                    img/
                    tmpl/
                    HelpController.js
                    HelpView.js
            Home/
                assets/
                    css/
                    img/
                    tmpl/
                HomeController.js
                HomeView.js
        Footer/
            assets/
                css/
                img/
                tmpl/
            FooterController.js
            FooterView.js
        Header/
            assets/
                css/
                img/
                tmpl/
            HeaderController.js
            HeaderView.js
        Menu/
            assets/
                css/
                img/
                tmpl/
            MenuController.js
            MenuView.js
web/
    index.html   // the project root HTML file
```

As you can see, each project is composed of modules, which in their turn can be composed of other modules. Each module should have a very clear responsibility within the project, thus avoiding spaghetti code.

The correlation between the module purpose and the file structure makes it really simple to understand where a module lives within a project, and what composes it.

Still, when dealing with reusable modules, that could show up in several places in the application, you can place the module wherever you feel the right place is. Ultimately, this is a developer's choice.

Since there is a clear separation of responsibilities, some modules might end up with some option that they don't know how to handle, and need to delegate that responsibility to another module. To enable this sort of operation, modules can upcast application events, delegating the responsibility to its parent, or even broadcast the event, and the whole project will listen to it.


#### Upcasting events

Upcasting events is very useful when you need to inform the parent module of something. In case the parent module does not know how to handle that information, it will automatically upcast the event, until a module is able to handle it. In case the event reaches the root module, and is not handled, a warning is issued in the console, making it easy to spot unhandled events.


#### Broadcasting events

Broadcasting can be particularly useful when you want to inform the whole application that something happened, like "user logged in", which would typically involve changes in several modules.



### State management and routing

One of the most complex tasks that developers face when developing applications is the state management.

The application state can be distributed, since an interface is usually composed of multiple modules, each with its own state. Due to the complexity of some applications, many state-of-the-art frameworks leave this task to the developer, giving him full flexibility over the state management. Unfortunately, these ad-hoc solutions are often poor, many times taking flexibility away, and the developer ultimately is forced to use *dirty hacks*, to make things work together.

Spoon.js offers a complete solution for handling state, without losing flexibility. Each controller declaratively specifies which states it can handle, and provides a handler function per state. How the state is actually is handled is completely up to the developer, giving him full control over the application.

The application state can be described by a simple string in the format `/articles.show(172)`. Lets take a closer look at what it means:

- `/` stands for root, meaning this is a full state, and the root controller (typically the Application controller) will be the starting point.
- `.` separates local states, which are handled by the controllers, and get removed from the full state along the handler chain. Note that this state only references two local states, `articles` and `show(172)`, but it can be more complex, like `articles.something.something_else(40,parameter).show(172)`.
- `articles` is the first local state, and the Application controller should have a handler for it, pushing the remaining state, `show(172)`, to whatever controller that should handle it.
- `show(172)` actually stands for the `show` state, with a parameter. When declaring a state, you can provide a list of parameters, and these get fed into the handler.

Another aspect that is usually tightly associated with state management is routing. Spoon.js offers a simple routing mechanism that maps the requested URLs to their respective state, and vice-versa. This routing mechanism gives the user full flexibility on what pattern matches a state.



### Declarative DOM event management

A very common task when developing web applications is attaching listeners to events on specific DOM elements. Although this is fine, it's not the most practical solution, and can have a significant impact on the performance, when the developer is not careful, in applications with lots of listeners.

To avoid this, the views can specify pseudo-selectors and handlers that get called when these selectors are matched. The underlying mechanism is very powerful, and creates a sort of sandbox for events. In practice, regardless of how many listeners you create on a view, only a single listener is actually created, per event type. Since the whole project is a tree, the Application view is actually the single project sandbox. Still, if necessary, you can turn any view into a sandbox, and it will be considered the *root* sandbox for itself, and its children.



### Model is a wildcard

Application Model is a very delicate matter and there simply isn't a one size fits all solution. There are too many approaches on how the model could be implemented, each with its advantage, and the truth is, this shouldn't be in the core of the framework.

Keeping this is mind, Spoon.js does not offer a solution for the Model in its core, although it will be providing a few libraries that you could use. This gives you full flexibility on how to implement the Model. You can either use one of the libraries we provide, implement your own, or simply use some SDK that you have been provided.



### Library agnostic

There are many flavours out there in terms of DOM management, and each developer has its own taste. This is why we've made sure that Spoon.js can work with the biggest libraries in the industry. Spoon.js currently supports jQuery, Dojo, Mootools, YUI3 and Zepto. This gives the developer great liberty in terms of what tools he can integrate into projects built with Spoon.js.



### Fast bootstrapping

Getting up and developing should be very simple, regardless of what the framework offers. The more entropy a framework has and more software the user has to install, the more complicated will be to actually start doing something useful. The framework should help the user, not step on his way.



### Fast develop-test lifecycle

One of the most annoying parts of the development process is to wait for building processes to finish before you can test something you just wrote, because your project is divided into multiple files that need to merged. More than annoying, this takes it toll on productivity. In normal operations, building should not be part of the develop and test lifecycle.

Introducing, the [AMD](http://requirejs.org/docs/whyamd.html) way. AMD, or Asynchronous Module Definition, is very handy for a variety of reasons, one of them being that you don't need to keep building a unified project file after every change. Each module you define with AMD declares its dependencies explicitly, making it very organised, and also speeding up develop and test round trips.



### Easy building

Building the project and preparing it for deployment shouldn't be a sort of black magic. It should be straight forward, with very concise steps. Also, taking into consideration that Spoon.js has very different approaches on some key points that affect the building process, it provides its own mechanisms that help you get the job done.





## Features

Besides all the concepts that are core to the framework, here's a list of features that compose Spoon.js.

### CLI

In order to speed up common tasks, like creating projects, testing, etc, Spoon.js offers a CLI tool that helps you get the job done.





## Feature Roadmap


### Storage service

A key-value storage service with support for persistence.


### I18n service

Simple 


### CSS live reloading


### Grunt.js build

The building process will be based in Grunt.js, allowing the user to completely customise the build.