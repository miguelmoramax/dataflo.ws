Documentation
=============

The code is documented with [JSDuck](https://github.com/senchalabs/jsduck)
comments.

To generate documentation site, you need to install JSDuck:

    gem install jsduck

And run the command:

    jsduck -o output-directory/ dataflows.js/

Don't mind the warnings (JSDuck isn't aware of Node.js built-ins).