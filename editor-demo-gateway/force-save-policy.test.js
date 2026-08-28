const test = require("node:test");
const assert = require("node:assert/strict");

const {
  gatewayStatusForUpstream,
  retryDelayMs,
  shouldRetryCommand,
} = require("./force-save-policy");

test("retries editor startup and not-modified responses while synchronization can still arrive", () => {
  for (const error of [1, 4]) {
    assert.equal(shouldRetryCommand(error, 0), true);
    assert.equal(shouldRetryCommand(error, 4), true);
    assert.equal(shouldRetryCommand(error, 5), false);
  }

  assert.deepEqual(
    Array.from({ length: 5 }, (_, attempt) => retryDelayMs(attempt)),
    [250, 500, 750, 1000, 1500],
  );
});

test("does not retry terminal editor command errors", () => {
  for (const error of [0, 2, 3, 5, 6, 7, null, undefined]) {
    assert.equal(shouldRetryCommand(error, 0), false);
  }
});

test("preserves successful upstream HTTP transport for logical command results", () => {
  assert.equal(gatewayStatusForUpstream(200), 200);
  assert.equal(gatewayStatusForUpstream(204), 200);
  assert.equal(gatewayStatusForUpstream(401), 502);
  assert.equal(gatewayStatusForUpstream(500), 502);
});
