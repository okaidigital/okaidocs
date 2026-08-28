const RETRYABLE_COMMAND_ERRORS = new Set([1, 4]);

const RETRY_DELAYS_MS = Object.freeze([250, 500, 750, 1000, 1500]);

function shouldRetryCommand(error, attempt) {
  return RETRYABLE_COMMAND_ERRORS.has(Number(error)) && attempt < RETRY_DELAYS_MS.length;
}

function retryDelayMs(attempt) {
  return RETRY_DELAYS_MS[attempt] ?? 0;
}

function gatewayStatusForUpstream(upstreamStatus) {
  const status = Number(upstreamStatus);
  return status >= 200 && status < 300 ? 200 : 502;
}

module.exports = {
  gatewayStatusForUpstream,
  retryDelayMs,
  shouldRetryCommand,
};
