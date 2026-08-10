// Preset compartilhado pelos jest.config.js de cada workspace.
// Mantem uma unica definicao de transform e cobertura para todo o monorepo.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  clearMocks: true,
  restoreMocks: true,
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/generated/'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/__tests__/**'],
  coverageDirectory: 'coverage',
  // Evita que testes pendurados travem o pipeline de CI.
  testTimeout: 15000,
};
