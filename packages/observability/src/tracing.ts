import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { TraceIdRatioBasedSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';
import { propagation, context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';

export interface TracingOptions {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint: string;
  enabled: boolean;
  samplingRatio: number;
}

let sdk: NodeSDK | undefined;

/**
 * Inicializa o tracing distribuido.
 *
 * DEVE ser chamado antes de qualquer `require` de express, pg ou amqplib,
 * porque as auto-instrumentacoes funcionam por interceptacao de modulo.
 * Por isso `server.ts` importa este modulo na primeira linha.
 *
 * A inicializacao e tolerante a falha: se o collector estiver indisponivel ou
 * o SDK nao puder subir, o servico continua funcionando sem tracing. Perder
 * telemetria e preferivel a derrubar o processamento de pedidos.
 */
export function initTracing(options: TracingOptions): void {
  if (!options.enabled) {
    return;
  }

  try {
    const exporter = new OTLPTraceExporter({
      url: `${options.otlpEndpoint.replace(/\/$/, '')}/v1/traces`,
    });

    sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: options.serviceName,
        [ATTR_SERVICE_VERSION]: options.serviceVersion,
        'deployment.environment.name': options.environment,
      }),

      // ParentBased garante que, uma vez amostrado no Gateway,
      // o trace inteiro seja amostrado nos servicos seguintes.
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(options.samplingRatio),
      }),

      // O NodeSDK cria internamente o BatchSpanProcessor apropriado
      // para o exporter, evitando conflito entre versoes de
      // @opentelemetry/sdk-trace-base.
      traceExporter: exporter,

      instrumentations: [
        getNodeAutoInstrumentations({
          // Instrumentacao de filesystem gera muito ruido
          // e pouco valor para este projeto.
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },

          '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (request) => {
              const url = request.url ?? '';

              return url.startsWith('/health') || url === '/metrics';
            },
          },
        }),
      ],
    });

    sdk.start();
  } catch (error) {
    console.error(
      '[tracing] Falha ao inicializar OpenTelemetry, seguindo sem tracing:',
      error instanceof Error ? error.message : String(error)
    );

    sdk = undefined;
  }
}

/**
 * Finaliza o SDK e tenta enviar os spans que ainda estiverem pendentes.
 */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } finally {
    sdk = undefined;
  }
}

const tracerName = 'loja-veloz';

/**
 * Executa uma funcao dentro de um span nomeado, marcando erro e status.
 *
 * Usado nos consumidores de mensagem, que nao sao cobertos pela
 * instrumentacao automatica de HTTP.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = trace.getTracer(tracerName);

  return tracer.startActiveSpan(name, { attributes }, async (span): Promise<T> => {
    try {
      const result = await fn(span);

      span.setStatus({
        code: SpanStatusCode.OK,
      });

      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error) {
        span.recordException(error);
      }

      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Serializa o trace context ativo em um objeto plano, para viajar nos headers
 * da mensagem AMQP.
 *
 * O RabbitMQ nao propaga contexto sozinho: a propagacao W3C
 * (`traceparent`/`tracestate`) e responsabilidade da aplicacao.
 */
export function injectTraceContext(carrier: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), carrier);

  return carrier;
}

/**
 * Reconstroi o contexto remoto a partir dos headers da mensagem e executa a
 * funcao dentro dele, ligando o span do consumidor ao span do produtor.
 */
export function runWithExtractedContext<T>(carrier: Record<string, unknown>, fn: () => T): T {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(carrier)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (Buffer.isBuffer(value)) {
      normalized[key] = value.toString('utf8');
    }
  }

  const extracted = propagation.extract(context.active(), normalized);

  return context.with(extracted, fn);
}
