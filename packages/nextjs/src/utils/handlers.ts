import { Scope } from '@sentry/hub';
import { captureException, flush, getCurrentHub, Handlers, startTransaction } from '@sentry/node';
import { extractTraceparentData, getActiveTransaction, hasTracingEnabled } from '@sentry/tracing';
import { addExceptionMechanism, isString, logger, stripUrlQueryAndFragment } from '@sentry/utils';
import * as domain from 'domain';
import { NextApiHandler, NextApiResponse } from 'next';

const { parseRequest } = Handlers;

// purely for clarity
type WrappedNextApiHandler = NextApiHandler;

type ScopedResponse = NextApiResponse & { __sentryScope?: Scope };

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const withSentry = (handler: NextApiHandler): WrappedNextApiHandler => {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  return async (req, res) => {
    // first order of business: monkeypatch `res.end()` so that it will wait for us to send events to sentry before it
    // fires (if we don't do this, the lambda will close too early and events will be either delayed or lost)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    res.end = wrapEndMethod(res.end);

    // use a domain in order to prevent scope bleed between requests
    const local = domain.create();
    local.add(req);
    local.add(res);

    // `local.bind` causes everything to run inside a domain, just like `local.run` does, but it also lets the callback
    // return a value. In our case, all any of the codepaths return is a promise of `void`, but nextjs still counts on
    // getting that before it will finish the response.
    const boundHandler = local.bind(async () => {
      const currentScope = getCurrentHub().getScope();

      if (currentScope) {
        currentScope.addEventProcessor(event => parseRequest(event, req));

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
            // TODO get this from next if possible, to avoid accidentally replacing non-dynamic parts of the path if
            // they match dynamic parts
            for (const [key, value] of Object.entries(req.query)) {
              reqPath = reqPath.replace(`${value}`, `[${key}]`);
            }
          }
          const reqMethod = `${(req.method || 'GET').toUpperCase()} `;

          const transaction = startTransaction(
            {
              name: `${reqMethod}${reqPath}`,
              op: 'http.server',
              ...traceparentData,
            },
            // extra context passed to the `tracesSampler`
            { request: req },
          );
          currentScope.setSpan(transaction);

          // save a link to the scope on the response, so that even if there's an error (landing us outside of
          // the domain), we can still finish the transaction and attach the correct data to it
          (res as ScopedResponse).__sentryScope = currentScope;
        }
      }

      try {
        return await handler(req, res); // Call original handler
      } catch (e) {
        if (currentScope) {
          currentScope.addEventProcessor(event => {
            addExceptionMechanism(event, {
              handled: false,
            });
            return event;
          });
          captureException(e);
        }
        throw e;
      }
    });

    return await boundHandler();
  };
};

type ResponseEndMethod = ScopedResponse['end'];
type WrappedResponseEndMethod = ScopedResponse['end'];

function wrapEndMethod(origEnd: ResponseEndMethod): WrappedResponseEndMethod {
  return async function newEnd(this: ScopedResponse, ...args: unknown[]) {
    // if the handler errored, it will have popped us out of the domain, so push the domain's scope onto the stack
    // just in case (if we *are* still in the domain, this will replace the current scope with a clone of itself,
    // which is effectively a no-op as long as we remember to pop it off when we're done)
    const currentHub = getCurrentHub();
    currentHub.pushScope(this.__sentryScope);

    const transaction = getActiveTransaction();

    if (transaction) {
      transaction.setHttpStatus(this.statusCode);

      // Push `transaction.finish` to the next event loop so open spans have a better chance of finishing before the
      // transaction closes, and make sure to wait until that's done before flushing events
      const transactionFinished: Promise<void> = new Promise(resolve => {
        setImmediate(() => {
          transaction.finish();
          resolve();
        });
      });
      await transactionFinished;
    }

    // flush the event queue to ensure that events get sent to Sentry before the response is finished and the lambda
    // ends
    try {
      logger.log('Flushing events...');
      await flush(2000);
    } catch (e) {
      logger.log(`Error while flushing events:\n${e}`);
    } finally {
      logger.log('Done flushing events');
    }

    // now that our work is done, we can pop off the scope and allow the response to end
    if (currentHub.getScope()?.getParent() === this.__sentryScope) {
      currentHub.popScope();
    } else {
      logger.warn('Found incorrect scope when popping. Please report this to the Sentry team.');
    }

    return origEnd.call(this, ...args);
  };
}
