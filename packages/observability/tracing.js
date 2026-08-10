// Ponto de entrada secundario do pacote.
//
// Motivo de existir: as auto-instrumentacoes do OpenTelemetry funcionam
// interceptando o `require` dos modulos instrumentados. Qualquer modulo
// carregado ANTES de `initTracing` deixa de ser instrumentado.
//
// O indice principal (`dist/index.js`) reexporta o middleware HTTP, que por
// sua vez carrega `express` e `pino-http`. Importar o indice principal para
// obter apenas o tracing carregaria o Express cedo demais e o servidor HTTP
// ficaria sem spans.
//
// Este arquivo permite `require('@loja-veloz/observability/tracing')` sem
// arrastar o restante do pacote, e funciona com a resolucao classica de
// modulos do Node, sem depender do campo "exports".
module.exports = require('./dist/tracing.js');
