const preset = require('../../jest.preset.js');

module.exports = {
  ...preset,
  rootDir: '.',
  displayName: 'integration',
  testMatch: ['**/*.integration.test.ts'],
  // O fluxo é assíncrono: um pedido passa por três serviços e cinco eventos
  // antes de chegar ao estado final. 60s dá folga para a máquina de CI sem
  // deixar um teste travado pendurar o pipeline.
  testTimeout: 60000,
  // Sequencial: os testes compartilham o mesmo estoque semeado, e rodar em
  // paralelo tornaria os saldos imprevisíveis.
  maxWorkers: 1,
};
