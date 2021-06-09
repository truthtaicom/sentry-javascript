import { captureException, getCurrentHub, Handlers, startTransaction, withScope } from '@sentry/node';
import { extractTraceparentData, getActiveTransaction, hasTracingEnabled } from '@sentry/tracing';
import { addExceptionMechanism, isString, logger, stripUrlQueryAndFragment } from '@sentry/utils';
import { NextApiHandler } from 'next';
import * as path from 'path';
import * as fs from 'fs';

import { addRequestDataToEvent, NextRequest } from './instrumentServer';

const { parseRequest } = Handlers;

// purely for clarity
type WrappedNextApiHandler = NextApiHandler;

// const { resolve } = require('path');
// const { readdir } = require('fs').promises;

// @ts-ignore
async function getFiles(dir: any): any {
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  // @ts-ignore
  const files = await Promise.all(
    dirents.map(dirent => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : res;
    }),
  );
  return Array.prototype.concat(...files);
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const withSentry = (handler: NextApiHandler): WrappedNextApiHandler => {
  getFiles('/var/task/.next')
    .then((files: any) => console.log(files))
    .catch((e: any) => console.error(e));
  console.log(process.env.BIG_SENTRY_SERVER_PATH);
  require(process.env.BIG_SENTRY_SERVER_PATH as string);
  // console.log('/var/task/.next/server');
  // fs.readdirSync('/var/task/.next/server').forEach(file => {
  //   console.log(file);
  // });
  // console.log('/var/task/.next/server/chunks');
  // fs.readdirSync('/var/task/.next/server/chunks').forEach(file => {
  //   console.log(file);
  // });
  // console.log(process.env.SENTRY_SERVER_INIT_PATH);
  // require(path.resolve(process.env.SENTRY_SERVER_INIT_PATH as string));
  const outerHub = getCurrentHub();
  const outerCurrentScope = outerHub.getScope();
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  return async (req, res) => {
    try {
      const hub = getCurrentHub();
      const currentScope = hub.getScope();

      res.once('finish', async () => {
        console.log('FINISHING TRANSACTION');
        const transaction = getActiveTransaction();
        if (transaction) {
          transaction.setHttpStatus(res.statusCode);

          // we'll collect this data in a more targeted way in the event processor we added above,
          // `addRequestDataToEvent`
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          delete transaction.metadata.requestPath;

          transaction.finish();
        }
        try {
          console.log('hub', hub);
          console.log('scope', currentScope);
          console.log('CLIENT', hub.getClient());
          console.log('outerHub', outerHub);
          console.log('outerCurrentScope', outerCurrentScope);
          await hub.getClient()?.flush(1000); //flush(2000);
        } catch (e) {
          console.log('FLUSH ERROR', e);
          // no-empty
        }
      });

      if (currentScope) {
        currentScope.addEventProcessor(event => addRequestDataToEvent(event, req as NextRequest));

        // We only want to record page and API requests
        if (hasTracingEnabled()) {
          // If there is a trace header set, extract the data from it (parentSpanId, traceId, and sampling decision)
          let traceparentData;
          if (req.headers && isString(req.headers['sentry-trace'])) {
            traceparentData = extractTraceparentData(req.headers['sentry-trace'] as string);
            logger.log(`[Tracing] Continuing trace ${traceparentData?.traceId}.`);
          }

          const url = `${req.url}`;
          // pull off query string, if any
          let reqPath = stripUrlQueryAndFragment(url);
          // Replace with placeholder
          if (req.query) {
            for (const [key, value] of Object.entries(req.query)) {
              reqPath = reqPath.replace(`${value}`, `[${key}]`);
            }
          }

          // requests for pages will only ever be GET requests, so don't bother to include the method in the transaction
          // name; requests to API routes could be GET, POST, PUT, etc, so do include it there
          const namePrefix = `${(req.method || 'GET').toUpperCase()} `;

          const transaction = startTransaction(
            {
              name: `${namePrefix}${reqPath}`,
              op: 'http.server',
              metadata: { requestPath: reqPath },
              ...traceparentData,
            },
            // extra context passed to the `tracesSampler`
            { request: req },
          );
          currentScope.setSpan(transaction);
        }
      }

      return await handler(req, res); // Call Handler
    } catch (e) {
      withScope(scope => {
        scope.addEventProcessor(event => {
          addExceptionMechanism(event, {
            handled: false,
          });
          return parseRequest(event, req);
        });
        captureException(e);
      });
      throw e;
    }
  };
};
