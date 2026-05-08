module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: {
    browser: false,
    node: true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  rules: {
    'import/extensions': ['error', { js: 'always' }],
    'linebreak-style': ['error', 'unix'],
    'no-param-reassign': [2, { props: false }],
    'no-console': 'off',
    'import/prefer-default-export': 'off',
    'no-restricted-syntax': [
      'error',
      { selector: 'ForInStatement', message: 'Use Object.{keys,values,entries} instead.' },
      { selector: 'LabeledStatement', message: 'Labels are a form of GOTO.' },
      { selector: 'WithStatement', message: '`with` is disallowed.' },
    ],
  },
};
