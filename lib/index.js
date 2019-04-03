'use strict';

const OpenTracing = require('opentracing');

const Pkg = require('../package.json');

exports.plugin = {
    name: 'opentracing',
    version: Pkg.version,
    register: async (server, options) => {

    }
};
