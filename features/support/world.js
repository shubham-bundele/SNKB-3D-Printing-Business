'use strict';

const { setWorldConstructor, World } = require('@cucumber/cucumber');

/**
 * Per-scenario state shared between step definitions.
 */
class QuoteWorld extends World {
  constructor(options) {
    super(options);
    /** @type {import('@playwright/test').APIRequestContext | null} */
    this.api = null;
    /** @type {import('@playwright/test').APIResponse | null} */
    this.response = null;
    /** @type {any} */
    this.responseBody = null;
  }
}

setWorldConstructor(QuoteWorld);

module.exports = { QuoteWorld };
