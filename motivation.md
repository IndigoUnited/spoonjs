SpoonJS
========

## Motivation

Even though frontend development has come a long way, and there are some good solutions out there, there are two main approaches:

1. Go "light", use a thin framework, that gives you a lot of flexibility, but ultimately leaves you responsible for some tedious, repetitive, and complex tasks.

2. Go "enterprise", use some solution that gives you a lot with no effort, and find yourself fighting the framework, trying to customise something.

Not being happy with this, and taking advantage of our experience, we set out to build a framework that would solve these issues, and a few more that were bugging us. The main drive of the framework is to help developers build solid applications faster, without that bitter-sweet feeling the development simplicity will eventually turn into a nightmare of unmaintainable code due to undocumented framework compromises or even bad options by the developer.

So, without getting too into the details, what defines Spoon.js? It's HMVC framework, the "H" stands for hierarchical. Unlike other frameworks, that organise the files depending of the extension, Spoon.js structures the project semantically. What this means is that the project is composed of modules, and this modularity can also be found in the way the project folders are organised. This hierarchy also means that each module has very specific responsibilities, and delegates responsibilities to its parent, but more on this later.