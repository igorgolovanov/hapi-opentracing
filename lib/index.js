'use strict';

const OpenTracing = require('opentracing');

const Pkg = require('../package.json');

const internals = {};

// Header names
internals.TRACE_PARENT = 'traceparent';
internals.TRACE_STATE = 'tracestate';
internals.DEFAULT_OPTIONS = 0x0;

exports.plugin = {
    name: 'opentracing',
    version: Pkg.version,
    register: (server, options) => {

        const tracer = new (options.mock ? internals.MockTracer : internals.NoopTracer)();

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
            set tracer(newTracer) {

                server.plugins.opentracing.tracer = newTracer;
            }
        });

        server.decorate('request', 'tracing', (request) => {

            return {
                get span() {

                    return request.plugins.opentracing.span;
                },
                tag(name, value) {

                    if (name === Object(name)) {
                        this.span.addTags(name);
                    }
                    else {
                        this.span.setTag(name, value);
                    }

                    return this;
                },
                log(keyValuePairs, timestamp) {

                    this.span.log(keyValuePairs, timestamp);
                    return this;
                },
                baggageItem(name, value) {

                    if (name === Object(name)) {
                        for (const [i, v] of Object.entries(name)) {
                            this.span.setBaggageItem(i, v);
                        }
                    }
                    else {
                        this.span.setBaggageItem(name, value);
                    }

                    return this;
                },
                startSpan(name, spanOptions = {}) {

                    return this.span.tracer().startSpan(name, {
                        ...spanOptions,
                        childOf: this.span.context()
                    });
                },
                inject(format, carrier) {

                    this.span.tracer().inject(this.span.context(), format, carrier);
                    return this;
                }
            };
        }, { apply: true });
    }
};

internals.extract = (format, carrier) => {

    const spanContext = {
        traceId: '',
        spanId: '',
        options: internals.DEFAULT_OPTIONS,
        traceState: undefined
    };

    let traceState = carrier[internals.TRACE_STATE];

    if (Array.isArray(traceState)) {
        // If more than one `tracestate` header is found, we merge them into a
        // single header.
        traceState = traceState.join(',');
    }

    spanContext.traceState = typeof traceState === 'string' ? traceState : undefined;

    // Read headers
    let traceParent = carrier[internals.TRACE_PARENT];

    if (Array.isArray(traceParent)) {
        traceParent = traceParent[0];
    }

    // Parse TraceParent into version, traceId, spanId, and option flags. All
    // parts of the header should be present or it is considered invalid.
    const parts = traceParent ? traceParent.split('-') : [];

    if (parts.length === 4) {
        // Both traceId and spanId must be of valid form for the traceparent
        // header to be accepted. If either is not valid we simply return the
        // empty spanContext.
        const version = parts[0];
        const traceId = parts[1];
        const spanId = parts[2];

        if (internals.isHex(version)
            && version.length === 2
            && internals.isHex(traceId)
            && internals.isHexNotAllZeros(traceId)
            && traceId.length === 32
            && internals.isHex(spanId)
            && internals.isHexNotAllZeros(spanId)
            && traceId.length === 16) {

            spanContext.traceId = traceId;
            spanContext.spanId = spanId;

            // Validate options. If the options are invalid we simply reset them to
            // default.

            let optionsHex = parts[3];

            if (!internals.isHex(optionsHex) || optionsHex.length !== 2) {
                optionsHex = internals.DEFAULT_OPTIONS.toString(16);
            }

            spanContext.options = Number('0x' + optionsHex);

            return new internals.SpanContext(spanContext);
        }
    }

    return null;
};

internals.inject = (spanContext, format, carrier) => {

    const optionsHex = Buffer.from([spanContext.options]).toString('hex');
    const traceIdHex = ('00000000000000000000000000000000' + spanContext.traceId).slice(-32);
    const spanIdHex = ('0000000000000000' + spanContext.spanId).slice(-16);
    const traceParent = `00-${traceIdHex}-${spanIdHex}-${optionsHex}`;

    if (typeof carrier.header === 'function') {

        carrier.header(internals.TRACE_PARENT, traceParent);

        if (spanContext.traceState) {

            carrier.header(internals.TRACE_STATE, spanContext.traceState);
        }

    }
    else {

        carrier[internals.TRACE_PARENT] = traceParent;

        if (spanContext.traceState) {

            carrier[internals.TRACE_STATE] = spanContext.traceState;
        }
    }
};

internals.SpanContext = class extends OpenTracing.SpanContext {
    constructor(context) {

        super();

        this.spanId = context.spanId;
        this.traceId = context.traceId;
        this.traceState = context.traceState;
        this.options = context.options;
    }

    toTraceId() {

        return this.traceId;
    }

    toSpanId() {

        return this.spanId;
    }
};

internals.NoopTracer = class extends OpenTracing.Tracer {

    _inject(context, format, carrier) {

        return internals.inject(context, format, carrier);
    }

    _extract(format, carrier) {

        return internals.extract(format, carrier);
    }
};

internals.MockTracer = class extends OpenTracing.MockTracer {

    _inject(context, format, carrier) {

        return internals.inject(context, format, carrier);
    }

    _extract(format, carrier) {

        return internals.extract(format, carrier);
    }
};

internals.isHex = (value) => typeof value === 'string' && /^[0-9A-F]*$/i.test(value);

internals.isHexNotAllZeros = (value) => typeof value === 'string' && !/^[0]*$/i.test(value);

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

    if (response.isBoom) {

        response.output.headers = Object.assign({}, response.output.headers, headers);
        response.reformat();
    }
    else {

        for (const [header, value] of Object.entries(headers)) {

            response.header(header, value);
        }
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
