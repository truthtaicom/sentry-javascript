import { getSentryRelease } from '@sentry/node';
import { dropUndefinedKeys, logger } from '@sentry/utils';
import * as SentryWebpackPlugin from '@sentry/webpack-plugin';

import {
  BuildContext,
  EntryPointObject,
  EntryPropertyObject,
  NextConfigObject,
  SentryWebpackPluginOptions,
  WebpackConfigFunction,
  WebpackConfigObject,
  WebpackEntryProperty,
} from './types';
import {
  CLIENT_SDK_CONFIG_FILE,
  CLIENT_SDK_INIT_BUNDLE,
  SERVER_SDK_CONFIG_FILE,
  SERVER_SDK_INIT_BUNDLE,
  storeServerConfigFileLocation,
} from './utils';

export { SentryWebpackPlugin };

// TODO: merge default SentryWebpackPlugin ignore with their SentryWebpackPlugin ignore or ignoreFile
// TODO: merge default SentryWebpackPlugin include with their SentryWebpackPlugin include
// TODO: drop merged keys from override check? `includeDefaults` option?

const defaultSentryWebpackPluginOptions = dropUndefinedKeys({
  url: process.env.SENTRY_URL,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  configFile: 'sentry.properties',
  stripPrefix: ['webpack://_N_E/'],
  urlPrefix: `~/_next`,
  include: '.next/',
  ignore: ['.next/cache', 'server/ssr-module-cache.js', 'static/*/_ssgManifest.js', 'static/*/_buildManifest.js'],
});

/**
 * Construct the function which will be used as the nextjs config's `webpack` value.
 *
 * Sets:
 *   - `devtool`, to ensure high-quality sourcemaps are generated
 *   - `entry`, to include user's sentry config files (where `Sentry.init` is called) in the build
 *   - `plugins`, to add SentryWebpackPlugin (TODO: optional)
 *
 * @param userNextConfig The user's existing nextjs config, as passed to `withSentryConfig`
 * @param userSentryWebpackPluginOptions The user's SentryWebpackPlugin config, as passed to `withSentryConfig`
 * @returns The function to set as the nextjs config's `webpack` value
 */
export function constructWebpackConfigFunction(
  userNextConfig: NextConfigObject = {},
  userSentryWebpackPluginOptions: Partial<SentryWebpackPluginOptions> = {},
): WebpackConfigFunction {
  console.log('process.env in constructWebpackConfigFunction:', process.env);
  // Will be called by nextjs and passed its default webpack configuration. Note that `defaultConfig` and `buildContext`
  // are referred to as `config` and `options` in the nextjs docs.
  const newWebpackFunction = (defaultConfig: WebpackConfigObject, buildContext: BuildContext): WebpackConfigObject => {
    console.log('target:', defaultConfig.target);
    let newConfig = { ...defaultConfig };

    // if we're building server code, store the webpack output path as an env variable, so we know where to look for the
    // webpack-processed version of `sentry.server.config.js` when we need it
    if (newConfig.target === 'node') {
      storeServerConfigFileLocation(newConfig);
    }

    // if user has custom webpack config (which always takes the form of a function), run it so we have actual values to
    // work with
    if ('webpack' in userNextConfig && typeof userNextConfig.webpack === 'function') {
      newConfig = userNextConfig.webpack(newConfig, buildContext);
    }

    // Tell webpack to inject user config files (containing the two `Sentry.init()` calls) into the appropriate output
    // bundles. Store a separate reference to the original `entry` value to avoid an infinite loop. (If we don't do
    // this, we'll have a statement of the form `x.y = () => f(x.y)`, where one of the things `f` does is call `x.y`.
    // Since we're setting `x.y` to be a callback (which, by definition, won't run until some time later), by the time
    // the function runs (causing `f` to run, causing `x.y` to run), `x.y` will point to the callback itself, rather
    // than its original value. So calling it will call the callback which will call `f` which will call `x.y` which
    // will call the callback which will call `f` which will call `x.y`... and on and on. Theoretically this could also
    // be fixed by using `bind`, but this is way simpler.)
    const origEntryProperty = newConfig.entry;
    newConfig.entry = async () => addSentryToEntryProperty(origEntryProperty, buildContext);

    // Enable the Sentry plugin (which uploads source maps to Sentry when not in dev) by default
    const enableWebpackPlugin = buildContext.isServer
      ? !userNextConfig.sentry?.disableServerWebpackPlugin
      : !userNextConfig.sentry?.disableClientWebpackPlugin;

    if (enableWebpackPlugin) {
      // TODO Handle possibility that user is using `SourceMapDevToolPlugin` (see
      // https://webpack.js.org/plugins/source-map-dev-tool-plugin/)
      // TODO Give user option to use `hidden-source-map` ?

      // Next doesn't let you change this is dev even if you want to - see
      // https://github.com/vercel/next.js/blob/master/errors/improper-devtool.md
      if (!buildContext.dev) {
        newConfig.devtool = 'source-map';
      }

      checkWebpackPluginOverrides(userSentryWebpackPluginOptions);

      newConfig.plugins = newConfig.plugins || [];
      newConfig.plugins.push(
        // @ts-ignore Our types for the plugin are messed up somehow - TS wants this to be `SentryWebpackPlugin.default`,
        // but that's not actually a thing
        new SentryWebpackPlugin({
          dryRun: buildContext.dev,
          release: getSentryRelease(buildContext.buildId),
          ...defaultSentryWebpackPluginOptions,
          ...userSentryWebpackPluginOptions,
        }),
      );
    }

    return newConfig;
  };

  return newWebpackFunction;
}

/**
 * Modify the webpack `entry` property so that the code in `sentry.server.config.js` and `sentry.client.config.js` is
 * included in the the necessary bundles.
 *
 * @param origEntryProperty The value of the property before Sentry code has been injected
 * @param buildContext Object passed by nextjs containing metadata about the build
 * @returns The value which the new `entry` property (which will be a function) will return (TODO: this should return
 * the function, rather than the function's return value)
 */
async function addSentryToEntryProperty(
  origEntryProperty: WebpackEntryProperty,
  buildContext: BuildContext,
): Promise<EntryPropertyObject> {
  // The `entry` entry in a webpack config can be a string, array of strings, object, or function. By default, nextjs
  // sets it to an async function which returns the promise of an object of string arrays. Because we don't know whether
  // someone else has come along before us and changed that, we need to check a few things along the way. The one thing
  // we know is that it won't have gotten *simpler* in form, so we only need to worry about the object and function
  // options. See https://webpack.js.org/configuration/entry-context/#entry.

  const modifiedEntryProperty =
    typeof origEntryProperty === 'function' ? await origEntryProperty() : { ...origEntryProperty };

  const webpackVersion = parseInt(buildContext.webpack.version[0]);

  let injectionType: 'dependency' | 'source file', injectedValue;
  const userConfigFile = buildContext.isServer ? SERVER_SDK_CONFIG_FILE : CLIENT_SDK_CONFIG_FILE;

  // In webpack 5, create separate bundles out of the user's `sentry.server.config.js` and `sentry.client.config.js`
  // file, and use `dependOn` in order to prevent code duplication. See
  // https://webpack.js.org/guides/code-splitting/#entry-dependencies.
  // if (webpackVersion >= 5) {
  if (webpackVersion > 5) {
    const newEntryPointName = buildContext.isServer ? SERVER_SDK_INIT_BUNDLE : CLIENT_SDK_INIT_BUNDLE;
    modifiedEntryProperty[newEntryPointName] = userConfigFile;

    injectionType = 'dependency';
    injectedValue = newEntryPointName;
  }
  // In webpack 4, include `sentry.server.config.js` and `sentry.client.config.js` directly in the relevant entries
  else {
    injectionType = 'source file';
    injectedValue = userConfigFile;
  }

  for (const entryPointName in modifiedEntryProperty) {
    if (entryPointName === 'pages/_app' || entryPointName.includes('pages/api')) {
      addToExistingEntryPoint(modifiedEntryProperty, {
        entryPointName,
        injectionType,
        injectedValue,
      });

      // webpack 4 and below can't handle a descriptor object, so just provide the value directly
      if (webpackVersion < 5) {
        modifiedEntryProperty[entryPointName] = (modifiedEntryProperty[entryPointName] as EntryPointObject).import;
      }
    }
  }

  return modifiedEntryProperty;
}

// /**
//  * Add a file to a specific element of the given `entry` webpack config property.
//  *
//  * @param entryProperty The existing `entry` config object
//  * @param entryPointName The key where the file should be injected
//  * @param filepath The path to the injected file
//  */
// function addFileToExistingEntryPoint(
//   entryProperty: EntryPropertyObject,
//   entryPointName: string,
//   filepath: string,
// ): void {
//   // can be a string, array of strings, or object whose `import` property is one of those two
//   let injectedInto = entryProperty[entryPointName];

//   // Sometimes especially for older next.js versions it happens we don't have an entry point
//   if (!injectedInto) {
//     // eslint-disable-next-line no-console
//     console.error(`[Sentry] Can't inject ${filepath}, no entrypoint is defined.`);
//     return;
//   }

//   // We inject the user's client config file after the existing code so that the config file has access to
//   // `publicRuntimeConfig`. See https://github.com/getsentry/sentry-javascript/issues/3485
//   if (typeof injectedInto === 'string') {
//     injectedInto = [injectedInto, filepath];
//   } else if (Array.isArray(injectedInto)) {
//     injectedInto = [...injectedInto, filepath];
//   } else {
//     let importVal: string | string[];

//     if (typeof injectedInto.import === 'string') {
//       importVal = [injectedInto.import, filepath];
//     } else {
//       importVal = [...injectedInto.import, filepath];
//     }

//     injectedInto = {
//       ...injectedInto,
//       import: importVal,
//     };
//   }

//   entryProperty[entryPointName] = injectedInto;
// }

// TODO docstring
function addToExistingEntryPoint(
  webpackEntryProperty: EntryPropertyObject,
  options: {
    entryPointName: string;
    injectionType: 'source file' | 'dependency';
    injectedValue: string;
  },
): void {
  const { entryPointName, injectionType, injectedValue } = options;

  // can be a string, array of strings, or object whose `import` and `dependOn` properties are each one of those two
  const currentEntryPoint = webpackEntryProperty[entryPointName];
  let newEntryPoint: EntryPointObject;

  // Sometimes especially for older next.js versions it happens we don't have an entry point
  if (!currentEntryPoint) {
    // eslint-disable-next-line no-console
    console.error(`[Sentry] Can't inject ${injectedValue}, no entrypoint is defined.`);
    return;
  }

  // In the case of injecting the user's server and client config files (the only source files we inject), we need to
  // put our filepath last so their code has access to `serverRuntimeConfig` and `publicRuntimeConfig`. (For injecting a
  // dependency it doesn't matter either way.) See https://github.com/getsentry/sentry-javascript/issues/3485.
  if (typeof currentEntryPoint === 'string') {
    newEntryPoint =
      injectionType === 'source file'
        ? { import: [injectedValue, currentEntryPoint] }
        : // { import: [currentEntryPoint, injectedValue] }
          { import: currentEntryPoint, dependOn: injectedValue };
  } else if (Array.isArray(currentEntryPoint)) {
    newEntryPoint =
      injectionType === 'source file'
        ? { import: [injectedValue, ...currentEntryPoint] }
        : // ? { import: [...currentEntryPoint, injectedValue] }
          { import: currentEntryPoint, dependOn: injectedValue };
  } else {
    const propertyName = injectionType === 'source file' ? 'import' : 'dependOn';
    const currentPropertyValue = currentEntryPoint[propertyName] || [];
    let newPropertyValue;

    if (typeof currentPropertyValue === 'string') {
      newPropertyValue = [injectedValue, currentPropertyValue];
      // newPropertyValue = [currentPropertyValue, injectedValue];
    } else {
      newPropertyValue = [injectedValue, ...currentPropertyValue];
      // newPropertyValue = [...currentPropertyValue, injectedValue];
    }

    newEntryPoint = {
      ...currentEntryPoint,
      [propertyName]: newPropertyValue,
    };
  }

  webpackEntryProperty[entryPointName] = newEntryPoint;
}

/**
 * Check the SentryWebpackPlugin options provided by the user against the options we set by default, and warn if any of
 * our default options are getting overridden. (Note: If any of our default values is undefined, it won't be included in
 * the warning.)
 *
 * @param userSentryWebpackPluginOptions The user's SentryWebpackPlugin options
 */
function checkWebpackPluginOverrides(userSentryWebpackPluginOptions: Partial<SentryWebpackPluginOptions>): void {
  // warn if any of the default options for the webpack plugin are getting overridden
  const sentryWebpackPluginOptionOverrides = Object.keys(defaultSentryWebpackPluginOptions)
    .concat('dryrun')
    .filter(key => key in userSentryWebpackPluginOptions);
  if (sentryWebpackPluginOptionOverrides.length > 0) {
    logger.warn(
      '[Sentry] You are overriding the following automatically-set SentryWebpackPlugin config options:\n' +
        `\t${sentryWebpackPluginOptionOverrides.toString()},\n` +
        "which has the possibility of breaking source map upload and application. This is only a good idea if you know what you're doing.",
    );
  }
}
