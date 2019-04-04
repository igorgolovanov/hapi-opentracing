'use strict';

const OpenTracing = require('opentracing');

const Pkg = require('../package.json');

const internals = {};

exports.plugin = {
    name: 'opentracing',
    version: Pkg.version,
    register: async (server, options) => {

        const tracer = new OpenTracing.Tracer();

        server.expose('tracer', tracer);

        server.ext('onRequest', internals.onRequest);
        server.ext('onPreResponse', internals.onPreResponse);

        server.events.on('response', (request) => {

            const span = request.plugins.opentracing.span;

            if (!span) {

                return;
            }


            if (request.response) {

                span.setTag(OpenTracing.Tags.HTTP_STATUS_CODE, request.response.statusCode);
            }
            else {

                span.setTag(OpenTracing.Tags.ERROR, true);
            }

            span.finish();
        });

        server.decorate('server', 'opentracing', {
            get tracer() {

                return server.plugins.opentracing.tracer;
            },
            set tracer(tracer) {

                server.plugins.opentracing.tracer = tracer;
            }
        });

        server.decorate('request', 'tracing',  (request) => {

            const span = request.plugins.opentracing.span;

            return {
                get span() {

                    return span;
                },
                tag(name, value) {

                    span.setTag(name, value);
                    return this;
                },
                log(keyValuePairs, timestamp) {

                    span.log(keyValuePairs, timestamp);
                    return this;
                },
                baggageItem(name, value) {

                    span.setBaggageItem(name, value);
                    return this;
                },
                startSpan(name, spanOptions = {}) {

                    return span.tracer().startSpan(name, {
                        ...spanOptions,
                        childOf: span.context(),
                    });
                },
                inject(format, carrier) {

                    span.tracer().inject(span.context(), format, carrier);
                    return this;
                }
            };
        }, { apply: true });
    }
};

internals.onPreResponse = (request, h) => {

    const span = request.plugins.opentracing.span;

    if (!span) {

        request.log(['opentracing', 'error'], 'opentracing span object is not available in request');

        return h.continue;
    }

    const tracer = request.server.opentracing.tracer;
    const response = request.response;
    const headers = {};

    tracer.inject(span.context(), OpenTracing.FORMAT_HTTP_HEADERS, headers);

    for (const [header, value] of Object.entries(headers)) {

        response.header(header, value);
    }

    span.setTag(OpenTracing.Tags.HTTP_STATUS_CODE, response.statusCode);

    return h.continue;
};

internals.onRequest = (request, h) => {

    const tracer = request.server.opentracing.tracer;

    const context = tracer.extract(OpenTracing.FORMAT_HTTP_HEADERS, request.raw.req.headers);
    const span = tracer.startSpan('http_request', { childOf: context });

    request.plugins.opentracing = { span };

    span.setTag(OpenTracing.Tags.HTTP_METHOD, request.method);
    span.setTag(OpenTracing.Tags.HTTP_URL, request.url.toString());

    return h.continue;
};
