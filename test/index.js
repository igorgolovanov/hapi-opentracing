'use strict';

const Code = require('@hapi/code');
const Lab = require('@hapi/lab');
const Hapi = require('@hapi/hapi');
const OpenTracing = require('..');

const { describe, it } = exports.lab = Lab.script();
const expect = Code.expect;

describe('OpenTracing', () => {


    it('should be registered with default options', async () => {

        const server = Hapi.server();
        await expect(server.register(OpenTracing)).to.not.reject();
    });

    it('should expose the tracer', async () => {

        const server = Hapi.server();
        await server.register(OpenTracing);

        expect(server.plugins.opentracing).to.be.an.object().and.contains('tracer');
        expect(server.plugins.opentracing.tracer).to.be.an.object();
    });

    describe('for each request lifecycle', () => {

        it('should create the tracing span', { plan: 2 }, async () => {

            const server = Hapi.server();
            await server.register(OpenTracing);

            server.route({
                path: '/test',
                method: '*',
                handler: (request) => {

                    expect(request.plugins.opentracing).to.be.an.object().and.contains('span');
                    expect(request.plugins.opentracing.span).to.be.an.object();

                    return 'OK';
                }
            });

            await server.initialize();
            await server.inject('/test');
        });

        it('should add http tags into tracing span', { plan: 3 }, async () => {

            const server = Hapi.server();
            await server.register({
                plugin: OpenTracing,
                options: {
                    mock: true
                }
            });

            let span = {};

            server.route({
                path: '/test',
                method: '*',
                handler: (request) => {

                    span = request.plugins.opentracing.span;

                    expect(span).to.be.an.object();

                    const info = span.debug();

                    expect(info.tags).to.contains(['http.method', 'http.url']);
                    expect(info.tags['http.method']).to.equals('get');

                    return 'OK';
                }
            });

            await server.initialize();
            await server.inject('/test');
        });

        it('should be decorated request with tracing object', { plan: 8 }, async () => {

            const server = Hapi.server();
            await server.register(OpenTracing);

            server.route({
                path: '/test',
                method: '*',
                handler: (request) => {

                    const span = request.plugins.opentracing.span;

                    expect(span).to.be.an.object();
                    expect(request.tracing).to.be.an.object();
                    expect(request.tracing.span).to.equals(span);
                    expect(request.tracing.log).to.be.a.function();
                    expect(request.tracing.tag).to.be.a.function();
                    expect(request.tracing.baggageItem).to.be.a.function();
                    expect(request.tracing.startSpan).to.be.a.function();
                    expect(request.tracing.inject).to.be.a.function();

                    return 'OK';
                }
            });

            await server.initialize();
            await server.inject('/test');

        });

        it('should write logs via request decorator (tracing)', { plan: 2 }, async () => {

            const server = Hapi.server();
            await server.register({
                plugin: OpenTracing,
                options: {
                    mock: true
                }
            });

            server.route({
                path: '/test',
                method: '*',
                handler: (request) => {

                    const span = request.plugins.opentracing.span;

                    expect(span).to.be.an.object();

                    request.tracing.log({
                        test2: 'test22',
                        test3: 'test33'
                    });

                    expect(span._logs[0].fields.length).to.equals(2);

                    return 'OK';
                }
            });

            await server.initialize();
            await server.inject('/test');

        });

        it('should add tags via request decorator (tracing)', { plan: 3 }, async () => {

            const server = Hapi.server();
            await server.register({
                plugin: OpenTracing,
                options: {
                    mock: true
                }
            });

            server.route({
                path: '/test',
                method: '*',
                handler: (request) => {

                    const span = request.plugins.opentracing.span;

                    expect(span).to.be.an.object();

                    request.tracing.tag('test', 'test');
                    request.tracing.tag({
                        test2: 'test22',
                        test3: 'test33'
                    });

                    const info = span.debug();

                    expect(info.tags).to.contains(['test', 'test2', 'test3']);
                    expect(info.tags.test3).to.equals('test33');

                    return 'OK';
                }
            });

            await server.initialize();
            await server.inject('/test');

        });

        it('should add baggage items via tracing request decorator', { plan: 1 }, async () => {

            const server = Hapi.server();
            await server.register(OpenTracing);

            server.route({
                path: '/test',
                method: '*',
                handler: (request) => {

                    const span = request.plugins.opentracing.span;

                    expect(span).to.be.an.object();

                    request.tracing.baggageItem('test', 'test');
                    request.tracing.baggageItem({
                        test2: 'test22',
                        test3: 'test33'
                    });

                    return 'OK';
                }
            });

            await server.initialize();
            await server.inject({
                url: '/test'
            });

        });

        it('should start new span with parent context via request decorator (tracing)', { plan: 3 }, async () => {

            const server = Hapi.server();
            await server.register({
                plugin: OpenTracing,
                options: {
                    mock: true
                }
            });

            server.route({
                path: '/test',
                method: '*',
                handler: (request) => {

                    const span = request.plugins.opentracing.span;

                    expect(span).to.be.an.object();

                    const testSpan = request.tracing.startSpan('test');

                    expect(testSpan).to.be.an.object();
                    expect(testSpan.operationName()).to.equals('test');

                    return 'OK';
                }
            });

            await server.initialize();
            await server.inject('/test');

        });


        it('should extract tracing context from request headers', { plan: 1 }, async () => {

            const traceId = '214365870921436587092143658709AC';
            const spanId = '2143658709ACF321';
            const headers = {
                'traceparent': `00-${traceId}-${spanId}-00`
            };

            const server = Hapi.server();
            await server.register({
                plugin: OpenTracing,
                options: {
                    mock: true
                }
            });

            server.route({
                path: '/test',
                method: '*',
                handler: (request) => {

                    const span = request.plugins.opentracing.span;

                    expect(span).to.be.a.object();

                    return 'OK';
                }
            });

            await server.initialize();
            await server.inject({
                url: '/test',
                headers: {
                    ...headers
                }
            });
        });

        it('should inject tracing context into response headers', async () => {

            const server = Hapi.server();
            await server.register({
                plugin: OpenTracing,
                options: {
                    mock: true
                }
            });

            server.route({
                path: '/test',
                method: '*',
                handler: () => {

                    return 'OK';
                }
            });

            await server.initialize();
            const response = await server.inject({
                url: '/test'
            });

            expect(response.statusCode).to.equals(200);
            expect(response.headers).to.contains(['traceparent']);

        });
    });
});
