export {
  Breadcrumb,
  Request,
  SdkInfo,
  Event,
  Exception,
  Response,
  Severity,
  StackFrame,
  Stacktrace,
  Status,
  Thread,
  User,
} from '@sentry/types';

export {
  addGlobalEventProcessor,
  addBreadcrumb,
  captureException,
  captureEvent,
  captureMessage,
  configureScope,
  getHubFromCarrier,
  getCurrentHub,
  Hub,
  Scope,
  setContext,
  setExtra,
  setExtras,
  setTag,
  setTags,
  setUser,
  startTransaction,
  Transports,
  withScope,
} from '@sentry/browser';

export { BrowserOptions } from '@sentry/browser';
export { BrowserClient, ReportDialogOptions } from '@sentry/browser';
export {
  defaultIntegrations,
  forceLoad,
  init,
  lastEventId,
  onLoad,
  showReportDialog,
  flush,
  close,
  wrap,
} from '@sentry/browser';
export { SDK_NAME, SDK_VERSION } from '@sentry/browser';

import { Integrations as BrowserIntegrations } from '@sentry/browser';
import { Integration } from '@sentry/types';
import { getGlobalObject } from '@sentry/utils';

import { BrowserTracing } from './browser';
import { addExtensionMethods } from './hubextensions';

export { Span } from './span';

type IntegrationMap = { [key: string]: Integration };

let windowIntegrations = {};

// This block is needed to add compatibility with the integrations packages when used with a CDN
const _window = getGlobalObject<Window>();
if (_window.Sentry && _window.Sentry.Integrations) {
  windowIntegrations = _window.Sentry.Integrations;
}

const INTEGRATIONS: IntegrationMap = {
  // TODO it's totally unclear why any of this typecasting is necessary - it's complaining that `setupOnce` is missing
  // from various of these (but it isn't) and that therefore they can't be considered instances of `Integration` (even
  // though they all implement `Integration`)
  ...((windowIntegrations as unknown) as IntegrationMap),
  ...((BrowserIntegrations as unknown) as IntegrationMap),
  BrowserTracing: (BrowserTracing as unknown) as Integration,
};

export { INTEGRATIONS as Integrations };

// We are patching the global object with our hub extension methods
addExtensionMethods();

export { addExtensionMethods };
