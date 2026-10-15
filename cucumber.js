'use strict';

/**
 * Cucumber configuration for the black-box API acceptance suite.
 *
 *   npm run test:api          # run every feature
 *   npx cucumber-js           # same thing directly
 *   npx cucumber-js features/quote.feature   # run one feature
 */

module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: [
      'features/support/**/*.js',
      'features/step_definitions/**/*.js',
    ],
    format: ['progress', 'summary'],
  },
};
