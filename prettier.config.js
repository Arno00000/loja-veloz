module.exports = {
  singleQuote: true,
  semi: true,
  trailingComma: 'es5',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    {
      files: ['*.md'],
      options: { proseWrap: 'preserve' },
    },
    {
      files: ['*.yml', '*.yaml'],
      options: { singleQuote: false },
    },
  ],
};
