'use strict';

const assert = require('node:assert/strict');

const { Given, When, Then } = require('@cucumber/cucumber');

const {
  createAsciiBoxStlBuffer,
  dimensionsForVolume,
} = require('../support/stlFixture');

const PLA_DENSITY_G_PER_MM3 = 0.00124; // 1.24 g/cm^3
const MATERIAL_RATE_PER_G = 2.0; // ₹2.00/g retail PLA+
const MACHINE_RATE_PER_HOUR = 25; // ₹25/print-hour
const PRINT_GRAMS_PER_HOUR = 12; // throughput assumption
const MAKING_RATE_PER_G = 1.0; // ₹1.00/g print labor
const SERVICE_FEE_FLAT = 39; // fixed service charge
const HANDLING_FEE_FLAT = 25; // fixed handling charge
const MIN_ORDER_VALUE = 149; // small-print minimum

Given('the quote API is available', async function () {
  const response = await this.api.get('/api/health');
  assert.equal(response.status(), 200, 'Expected the health endpoint to return 200.');
});

When(
  'I upload a valid mock STL model with a volume of {int} cubic millimetres',
  async function (volumeMm3) {
    const dimensions = dimensionsForVolume(volumeMm3);
    const buffer = createAsciiBoxStlBuffer(dimensions);

    assert.equal(
      dimensions.x * dimensions.y * dimensions.z,
      volumeMm3,
      'The mock box must have exactly the requested volume.',
    );

    this.response = await this.api.post('/api/quote', {
      multipart: {
        file: {
          name: 'mock-model.stl',
          mimeType: 'model/stl',
          buffer,
        },
      },
    });
    this.responseBody = await this.response.json();
  },
);

When(
  'I upload a mock STL model with an X-axis bounding box of {int} mm',
  async function (xDimension) {
    const buffer = createAsciiBoxStlBuffer({ x: xDimension, y: 20, z: 20 });

    this.response = await this.api.post('/api/quote', {
      multipart: {
        file: {
          name: 'oversized-model.stl',
          mimeType: 'model/stl',
          buffer,
        },
      },
    });
    this.responseBody = await this.response.json();
  },
);

Then('the response status code should be {int}', function (expectedStatus) {
  assert.equal(
    this.response.status(),
    expectedStatus,
    `Unexpected status. Body: ${JSON.stringify(this.responseBody)}`,
  );
});

Then('the calculated weight should be {float} grams', function (expectedWeight) {
  const expected = expectedWeight;
  assert.equal(
    this.responseBody.weightGrams,
    expected,
    `Expected weight ${expected} g but received ${this.responseBody.weightGrams} g.`,
  );

  // Independently confirm the value matches the PLA+ density rule.
  const volumeMm3 = this.responseBody.volumeMm3;
  const derived = Math.round(volumeMm3 * PLA_DENSITY_G_PER_MM3 * 1000) / 1000;
  assert.equal(derived, expected, 'Weight does not match volume x 0.00124 g/mm^3.');
});

Then('the retail material price should be ₹{float}', function (expectedPrice) {
  const expected = expectedPrice;
  assert.equal(
    this.responseBody.materialCost,
    expected,
    `Expected material price ₹${expected} but received ₹${this.responseBody.materialCost}.`,
  );

  // Independently confirm the value matches the ₹2.00/g retail rule.
  const derived =
    Math.round(this.responseBody.weightGrams * MATERIAL_RATE_PER_G * 100) / 100;
  assert.equal(derived, expected, 'Price does not match weight x ₹2.00/g.');
});

Then(
  'the customer total should be ₹{float} with no minimum applied',
  function (expectedTotal) {
    const body = this.responseBody;
    assert.equal(
      body.totalPrice,
      expectedTotal,
      `Expected total ₹${expectedTotal} but received ₹${body.totalPrice}.`,
    );
    assert.equal(body.currency, 'INR');
    assert.equal(
      body.minimumApplied,
      false,
      'Expected no small-print minimum on this order size.',
    );

    // Independently confirm material + machine + making + service + handling.
    // 18.6 g: 37.20 + (1.55 h x ₹25) 38.75 + 18.60 + 39 + 25 = 158.55 -> 159.
    const machineHours =
      Math.round((body.weightGrams / PRINT_GRAMS_PER_HOUR) * 100) / 100;
    assert.equal(body.machineHours, machineHours);
    const machineCost =
      Math.round(machineHours * MACHINE_RATE_PER_HOUR * 100) / 100;
    assert.equal(body.machineCost, machineCost);
    assert.equal(body.serviceFee, SERVICE_FEE_FLAT);
    const makingCost =
      Math.round(body.weightGrams * MAKING_RATE_PER_G * 100) / 100;
    assert.equal(body.makingCost, makingCost);
    assert.equal(body.handlingFee, HANDLING_FEE_FLAT);
    const subtotal =
      Math.round(
        (body.materialCost + machineCost + makingCost + SERVICE_FEE_FLAT + HANDLING_FEE_FLAT) * 100
      ) / 100;
    assert.equal(body.subtotal, subtotal);
    assert.equal(Math.max(MIN_ORDER_VALUE, Math.round(subtotal)), expectedTotal);
  },
);

Then(
  'the error should report that the X axis exceeds the {int} mm build limit',
  function (limit) {
    const body = this.responseBody;

    assert.equal(body.success, false, 'Expected success to be false.');
    assert.ok(Array.isArray(body.exceededAxes), 'Expected an exceededAxes array.');
    assert.equal(
      body.error,
      'build_volume_exceeded',
      `Unexpected error code: ${body.error}`,
    );

    const xAxis = body.exceededAxes.find((entry) => entry.axis === 'x');
    assert.ok(xAxis, `Expected an "x" entry in ${JSON.stringify(body.exceededAxes)}.`);
    assert.equal(xAxis.limit, limit);
    assert.ok(xAxis.dimension > limit, 'Expected the X dimension to exceed the limit.');
    assert.match(
      body.message,
      new RegExp(`180.*180.*180`),
      'Expected the message to state the 180 x 180 x 180 mm build volume.',
    );
  },
);
