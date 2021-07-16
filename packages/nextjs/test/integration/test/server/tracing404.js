const assert = require('assert');

const { sleep } = require('../utils/common');
const { getAsync, interceptTracingRequest } = require('../utils/server');

module.exports = async ({ url: urlBase, argv }) => {
  const url = `${urlBase}/api/missing`;
  const capturedRequest = interceptTracingRequest(
    {
      contexts: {
        trace: {
          op: 'http.server',
          status: 'not_found',
          tags: { 'http.status_code': '404' },
        },
      },
      transaction: 'GET /404',
      type: 'transaction',
      request: {
        url,
      },
    },
    argv,
  );

  await getAsync(url);
  await sleep(100);

  assert.ok(capturedRequest.isDone(), 'Did not intercept expected request');
};
