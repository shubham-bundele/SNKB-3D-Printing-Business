Feature: 3D Print Quote API
  The SNKB backend issues itemized INR print quotes (retail material + machine
  time + fixed service charge, floored at the small-print minimum). Every quote
  must price PLA+ material correctly, and any model that does not fit the
  180 x 180 x 180 mm build volume must be rejected before a price is returned.

  Background:
    Given the quote API is available

  @happy-path @pricing
  Scenario: Valid upload returns an itemized INR quote
    When I upload a valid mock STL model with a volume of 15000 cubic millimetres
    Then the response status code should be 200
    And the calculated weight should be 18.6 grams
    And the retail material price should be ₹37.20
    And the customer total should be ₹159.00 with no minimum applied

  @hardware-limit @validation
  Scenario: Uploaded model exceeding the X-axis build limit is rejected
    When I upload a mock STL model with an X-axis bounding box of 185 mm
    Then the response status code should be 400
    And the error should report that the X axis exceeds the 180 mm build limit
