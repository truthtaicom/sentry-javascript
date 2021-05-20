import { getSentryRelease } from '@sentry/node';
import { logger } from '@sentry/utils';
import defaultWebpackPlugin, { SentryCliPluginOptions } from '@sentry/webpack-plugin';
import * as SentryWebpackPlugin from '@sentry/webpack-plugin';
import * as fs from 'fs';
import * as path from 'path';

const SENTRY_CLIENT_CONFIG_FILE = './sentry.client.config.js';
const SENTRY_SERVER_CONFIG_FILE = './sentry.server.config.js';
// this is where the transpiled/bundled version of `USER_SERVER_CONFIG_FILE` will end up
export const SERVER_SDK_INIT_PATH = 'sentry/initServerSDK.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlainObject<T = any> = { [key: string]: T };

// The function which is ultimately going to be exported from `next.config.js` under the name `webpack`
type WebpackExport = (config: WebpackConfig, options: WebpackOptions) => WebpackConfig;

// The two arguments passed to the exported `webpack` function, as well as the thing it returns
type WebpackConfig = {
  devtool: string;
  plugins: PlainObject[];
  entry: EntryProperty;
  output: { path: string };
  target: string;
  context: string;
};
type WebpackOptions = { dev: boolean; isServer: boolean; buildId: string; webpack: { version: string } };

// For our purposes, the value for `entry` is either an object, or a function which returns such an object. In the
// following types, notice the difference between `EntryProperty` (the entire collection of entry points) and
// `EntryPoint` (a single entry point)
type EntryProperty = (() => Promise<EntryPropertyValue>) | EntryPropertyValue;
type EntryPropertyValue = { [key: string]: EntryPointValue };
type EntryPointValue = string | Array<string> | EntryPointDescriptor;
type EntryPointDescriptor = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  // if the entry point value is an object, the files to include are listed here, in the `import` property
  import: string | Array<string>;
};

/**
 * Do a deep merge* of the given entry point values.
 *
 * *All but the `library` property are deep merged.
 *
 * @param entryPoints An array of entry point values to merge
 * @param isWebpack4 Boolean which controls the output format
 * @returns A single entry point value
 */
const _mergeEntryPoints = (entryPoints: EntryPointValue[], isWebpack4: boolean): EntryPointValue => {
  // Regardless of the initial form of the entries, if we're in webpack 5 we'll return an EntryPointDescriptor, and if
  // we're in webpack 4, we'll return an array. Assume the more complicated form for the moment (and reflect it in the
  // initial value for the merged result) because we can always simplify later (where we couldn't go the other way).
  let mergedValue = { import: [] } as EntryPointValue;

  mergedValue = entryPoints.reduce(
    (accumulatedValue: EntryPointValue, currentValue: EntryPointValue): EntryPointDescriptor => {
      let newAccumulatedValue = accumulatedValue as EntryPointDescriptor;

      if (typeof currentValue === 'string') {
        (newAccumulatedValue.import as string[]).push(currentValue);
      } else if (Array.isArray(currentValue)) {
        newAccumulatedValue.import = [...(newAccumulatedValue.import as string[]), ...currentValue];
      }
      // `currentValue` must be an object
      else {
        // `import` and `dependOn` are both values which can be either strings or string arrays, so they take a bit of
        // extra work to merge
        const newMaybeArrayTypeValues: { [key: string]: string[] } = {};

        ['import', 'dependOn'].forEach((entryObjectOption: string) => {
          let newOptionValue = (newAccumulatedValue[entryObjectOption] as string[]) || [];

          // merge in new `dependOn` value, if it exists
          if (currentValue[entryObjectOption]) {
            if (typeof currentValue[entryObjectOption] === 'string') {
              newOptionValue.push(currentValue.dependOn);
            }
            // being an array is the only other option, but it keeps TS happy to check
            else if (Array.isArray(currentValue[entryObjectOption])) {
              newOptionValue = [...newOptionValue, ...currentValue[entryObjectOption]];
            }
          }

          // only add it in if there's actual stuff there
          if (newOptionValue.length > 0) {
            newMaybeArrayTypeValues[entryObjectOption] = newOptionValue;
          }
        });

        // Note: Technically, `library` is also an option whose values have a complex format and which needs careful
        // merging. Punting on that for the moment, and just letting the later value overwrite the earlier one for now.
        // We can revisit this if it ever becomes a problem.
        newAccumulatedValue = {
          ...newAccumulatedValue,
          ...currentValue,
          ...newMaybeArrayTypeValues,
        };
      }

      return newAccumulatedValue;
    },

    // initial value for the `reduce` function
    mergedValue,
  );

  // the entry point descriptor syntax is new in webpack 5, so if we're dealing with webpack 4, we've wrapped the array
  // of files up in an object when we shouldn't have, so pull it back out
  if (isWebpack4) {
    mergedValue = (mergedValue as EntryPointDescriptor).import;
  }

  return mergedValue;
};

/**
 * Add `sentry.server.config.js` and `sentry.client.config.js` (where the user calls `Sentry.init()`) to the respective
 * bundles.
 *
 * @param origEntryProperty The incoming `entry` webpack config option
 * @param isServer Boolean reflecting whether we're building server bundles or client bundles
 * @param isWebpack4 Boolean controling the format of the results on the client side
 * @returns The modified `entry` property, with sentry startup code injected
 */
const injectSentry = async (
  origEntryProperty: EntryProperty,
  isServer: boolean,
  isWebpack4: boolean,
): Promise<EntryProperty> => {
  // The `entry` entry in a webpack config can be a string, array of strings, object, or function. By default, nextjs
  // sets it to an async function which returns the promise of an object of string arrays. Because we don't know whether
  // someone else has come along before us and changed that, we need to check a few things along the way. The one thing
  // we know is that it won't have gotten *simpler* in form, so we only need to worry about the object and function
  // options. See https://webpack.js.org/configuration/entry-context/#entry.

  let newEntryProperty = origEntryProperty;
  if (typeof origEntryProperty === 'function') {
    newEntryProperty = await origEntryProperty();
  }
  newEntryProperty = newEntryProperty as EntryPropertyValue;

  if (isServer) {
    // By adding a new element to the `entry` array, we force webpack to create a bundle out of the user's
    // `sentry.server.config.js` file and output it to `SERVER_INIT_LOCATION`. (See
    // https://webpack.js.org/guides/code-splitting/#entry-points.) We do this so that the user's config file is run
    // through babel (and any other processors through which next runs the rest of the user-provided code - pages, API
    // routes, etc.). Specifically, we need any ESM-style `import` code to get transpiled into ES5, so that we can call
    // `require()` on the resulting file when we're instrumenting the sesrver. (We can't use a dynamic import there
    // because that then forces the user into a particular TS config.)
    newEntryProperty[SERVER_SDK_INIT_PATH] = SENTRY_SERVER_CONFIG_FILE;
  } else {
    // On the client, it's sufficient to inject it into the `main` JS code, which is included in every browser page. We
    // also merge in (and then delete) the legacy entry at `main.js`, since our doing all of this prevents `next` from
    // doing the same thing. See
    // https://github.com/vercel/next.js/blob/25096df801c121c6e96268422b84af2a4a907888/packages/next/build/webpack-config.ts#L1607-L1632
    newEntryProperty['main'] = _mergeEntryPoints(
      [newEntryProperty['main.js'], newEntryProperty['main'], SENTRY_CLIENT_CONFIG_FILE],
      isWebpack4,
    );
    delete newEntryProperty['main.js'];
  }
  return newEntryProperty;
};

type NextConfigExports = {
  experimental?: { plugins: boolean };
  plugins?: string[];
  productionBrowserSourceMaps?: boolean;
  webpack?: WebpackExport;
};

/**
 * Add Sentry options to the config to be exported from the user's `next.config.js` file.
 *
 * @param providedExports The existing config to be exported ,prior to adding Sentry
 * @param providedSentryWebpackPluginOptions Configuration for SentryWebpackPlugin
 * @returns The modified config to be exported
 */
export function withSentryConfig(
  providedExports: NextConfigExports = {},
  providedSentryWebpackPluginOptions: Partial<SentryCliPluginOptions> = {},
): NextConfigExports {
  const defaultSentryWebpackPluginOptions = {
    url: process.env.SENTRY_URL,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    configFile: 'sentry.properties',
    stripPrefix: ['webpack://_N_E/'],
    urlPrefix: `~/_next`,
    include: '.next/',
    ignore: ['.next/cache', 'server/ssr-module-cache.js', 'static/*/_ssgManifest.js', 'static/*/_buildManifest.js'],
  };

  // warn if any of the default options for the webpack plugin are getting overridden
  const sentryWebpackPluginOptionOverrides = Object.keys(defaultSentryWebpackPluginOptions)
    .concat('dryrun')
    .filter(key => key in Object.keys(providedSentryWebpackPluginOptions));
  if (sentryWebpackPluginOptionOverrides.length > 0) {
    logger.warn(
      '[Sentry] You are overriding the following automatically-set SentryWebpackPlugin config options:\n' +
        `\t${sentryWebpackPluginOptionOverrides.toString()},\n` +
        "which has the possibility of breaking source map upload and application. This is only a good idea if you know what you're doing.",
    );
  }

  const newWebpackExport = (config: WebpackConfig, options: WebpackOptions): WebpackConfig => {
    // if we're building server code, store the webpack output path as an env variable, so we know where to look for the
    // webpack-processed version of `sentry.server.config.js` when we need it
    if (config.target === 'node') {
      const serverSDKInitOutputPath = path.join(config.output.path, SERVER_SDK_INIT_PATH);
      const projectDir = config.context;
      setRuntimeEnvVars(projectDir, { SENTRY_SERVER_INIT_PATH: serverSDKInitOutputPath });
    }

    let newConfig = config;

    if (typeof providedExports.webpack === 'function') {
      newConfig = providedExports.webpack(config, options);
    }

    // Ensure quality source maps in production. (Source maps aren't uploaded in dev, and besides, Next doesn't let you
    // change this is dev even if you want to - see
    // https://github.com/vercel/next.js/blob/master/errors/improper-devtool.md.)
    if (!options.dev) {
      newConfig.devtool = 'source-map';
    }

    // Inject user config files (`sentry.client.confg.js` and `sentry.server.config.js`), which is where `Sentry.init()`
    // is called. By adding them here, we ensure that they're bundled by webpack as part of both server code and client code.
    newConfig.entry = (injectSentry(
      newConfig.entry,
      options.isServer,
      options.webpack.version.startsWith('4'),
    ) as unknown) as EntryProperty;

    // Add the Sentry plugin, which uploads source maps to Sentry when not in dev
    newConfig.plugins.push(
      // TODO it's not clear how to do this better, but there *must* be a better way
      new ((SentryWebpackPlugin as unknown) as typeof defaultWebpackPlugin)({
        dryRun: options.dev,
        release: getSentryRelease(options.buildId),
        ...defaultSentryWebpackPluginOptions,
        ...providedSentryWebpackPluginOptions,
      }),
    );

    return newConfig;
  };

  return {
    ...providedExports,
    productionBrowserSourceMaps: true,
    webpack: newWebpackExport,
  };
}

/**
 * Set variables to be added to the env at runtime, by storing them in `.env.local` (which `next` automatically reads
 * into memory at server startup).
 *
 * @param projectDir The path to the project root
 * @param vars Object containing vars to set
 */
function setRuntimeEnvVars(projectDir: string, vars: PlainObject<string>): void {
  // ensure the file exists
  const envFilePath = path.join(projectDir, '.env.local');
  if (!fs.existsSync(envFilePath)) {
    fs.writeFileSync(envFilePath, '');
  }

  let fileContents = fs
    .readFileSync(envFilePath)
    .toString()
    .trim();

  Object.entries(vars).forEach(entry => {
    const [varName, value] = entry;
    const envVarString = `${varName}=${value}`;

    // new entry
    if (!fileContents.includes(varName)) {
      fileContents = `${fileContents}\n${envVarString}`;
    }
    // existing entry; make sure value is up to date
    else {
      fileContents = fileContents.replace(new RegExp(`${varName}=\\S+`), envVarString);
    }
  });

  fs.writeFileSync(envFilePath, `${fileContents.trim()}\n`);
}
