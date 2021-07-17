import { Hub } from '@sentry/hub';
import { EventProcessor, Integration } from '@sentry/types';
import { fill, isThenable, loadModule, logger } from '@sentry/utils';

interface MssqlClient {
  prototype: {
    query: () => void | Promise<unknown>;
  };
}

/** Tracing integration for node-postgres package */
export class Mssql implements Integration {
  /**
   * @inheritDoc
   */
  public static id: string = 'Mssql';

  /**
   * @inheritDoc
   */
  public name: string = Mssql.id;

  /**
   * @inheritDoc
   */
  public setupOnce(_: (callback: EventProcessor) => void, getCurrentHub: () => Hub): void {
    const pkg = loadModule<{ Client: MssqlClient }>('mssql/lib/base/request');

    if (!pkg) {
      logger.error('Mssql Integration was unable to require `mssql` package.');
      return;
    }

    /**
     * function (query, callback) => void
     * function (query, params, callback) => void
     * function (query) => Promise
     * function (query, params) => Promise
     * function (pg.Cursor) => pg.Cursor
     */
    fill(pkg.Client.prototype, 'query', function(orig: () => void | Promise<unknown>) {
      return function(this: unknown, config: unknown, values: unknown, callback: unknown) {
        const scope = getCurrentHub().getScope();
        const parentSpan = scope?.getSpan();
        const span = parentSpan?.startChild({
          description: typeof config === 'string' ? config : (config as { text: string }).text,
          op: `db`,
        });

        if (typeof callback === 'function') {
          return orig.call(this, function(err: Error, result: unknown) {
            span?.finish();
            callback(err, result);
          });
        }

        const rv = orig.call(this, config, values);

        if (isThenable(rv)) {
          return (rv as Promise<unknown>).then((res: unknown) => {
            span?.finish();
            return res;
          });
        }

        span?.finish();
        return rv;
      };
    });
  }
}
