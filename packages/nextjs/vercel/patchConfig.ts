/**
 *
 * all intrapackage deps modified to be gitpkg deps -> git branch name
 * get rid of volta entries in package.json files
 * create gitpkg url for @sentry/nextjs to use in test app -> git branch name
 * cobble together complete tsconfigs - no more "extends" (use `tsc --showConfig`, but beware relative paths)
 *
 *
 *
 * require package.json and tsconfig.x.json, modify the values, write to disk w JSON.stringify(), the use prettier to clean them up
 *
 */

import { exec } from 'child_process';
import * as eslint from 'eslint';
import * as fs from 'fs';
import * as path from 'path';
import * as prettier from 'prettier';
import { promisify } from 'util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlainObject<T = any> = { [key: string]: T };
type StringObject = PlainObject<string>;

type PackageJSON = { name: string; dependencies: StringObject; devDependencies: StringObject; volta?: StringObject };

type TSConfig = { extends?: string; compilerOptions?: PlainObject };

async function asyncForEach<T>(arr: T[], callback: (element: T, index: number, arr: T[]) => unknown): Promise<void> {
  for (let i = 0; i < arr.length; i++) {
    await callback(arr[i], i, arr);
  }
}

async function doPatching(): Promise<void> {
  const packagesDir = path.resolve('../../packages');

  // get the names of all the packages
  const packageDirNames: string[] = fs
    .readdirSync(packagesDir)
    .map(fileOrDir => path.resolve(packagesDir, fileOrDir))
    .filter(fileOrDirPath => fs.statSync(fileOrDirPath).isDirectory())
    .map(dirAbsPath => path.basename(dirAbsPath));

  // compute a gitPkg URL for each, and cache it (this is in a separate loop because we need all of them to be computed
  // before any of iterations of the loop below
  const gitBranch = await getGitBranch();
  const gitPkgURLs: StringObject = {};
  packageDirNames.forEach(dirName => {
    const npmName = ['eslint-config-sdk', 'eslint-plugin-sdk', 'typescript'].includes(dirName)
      ? `@sentry-internal/${dirName}`
      : `@sentry/${dirName}`;
    gitPkgURLs[npmName] = `https://gitpkg.now.sh/getsentry/sentry-javascript/packages/${dirName}?${gitBranch}`;
  });

  // make the necessary changes in each package's package.json
  await asyncForEach(packageDirNames, async dirName => {
    const packageJSONPath = path.resolve(packagesDir, dirName, 'package.json');

    await patchPackageJSON(packageJSONPath, gitPkgURLs);
  });
  // await asyncForEach(packageDirNames, async dirName => {
  //   const packageJSONPath = path.resolve(packagesDir, dirName, 'package.json');

  //   // eslint-disable-next-line @typescript-eslint/no-var-requires
  //   const packageJSON = require(packageJSONPath) as PackageJSON;

  //   // we don't care about it and it's got a relative path that might not play well on vercel
  //   delete packageJSON.volta;

  //   // replace the versions of all `@sentry/x` packages (the ones from this repo, at least) with the appropriate URL, in
  //   // both regular and dev dependencies
  //   for (const depName in packageJSON.dependencies) {
  //     if (depName in gitPkgURLs) {
  //       packageJSON.dependencies[depName] = gitPkgURLs[depName];
  //     }
  //   }
  //   for (const depName in packageJSON.devDependencies) {
  //     if (depName in gitPkgURLs) {
  //       packageJSON.devDependencies[depName] = gitPkgURLs[depName];
  //     }
  //   }

  //   await writeFormattedJSON(packageJSON, packageJSONPath);
  // });

  // compile full tsconfig files, following any `extends` entries to their source
  const tsConfigFiles = fs
    // .readdirSync('..')
    .readdirSync('.')
    .filter(fileOrDirName => fileOrDirName.includes('tsconfig'))
    // .map(configFile => path.resolve('..', configFile));
    .map(configFile => path.resolve('.', configFile));

  // TODO have to grab and cache blobs before we do any rewriting on disk since one depends on another
  await asyncForEach(tsConfigFiles, async configFilePath => {
    const configBlobs: TSConfig[] = [];
    let currentConfigFile = configFilePath;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // grab the config values from the file we're currently looking at
      const config = require(currentConfigFile) as TSConfig; // eslint-disable-line @typescript-eslint/no-var-requires
      configBlobs.push(config);

      // if this config extends another, go look at that one
      if (config.extends) {
        const currentConfigDir = path.dirname(currentConfigFile);
        const extendee = path.resolve(currentConfigDir, config.extends);
        currentConfigFile = extendee;
      }
      // we've reached the top of the tree
      else {
        break;
      }
    }

    const fullConfig: TSConfig = { compilerOptions: {} };

    // layer config blobs on top of each other, starting with the top of the tree (pushed into the blob array last),
    // shallow-merging compiler options and overwriting all other values with new ones as we layer
    while (configBlobs.length) {
      const { compilerOptions: currentCompilerOptions, ...rest } = configBlobs.pop() as TSConfig;
      Object.assign(fullConfig.compilerOptions, currentCompilerOptions || {});
      Object.assign(fullConfig, rest || {});
    }

    // now that we've used it to walk the inheritance tree, get rid of the `extends` property so its relative path
    // doesn't confuse vercel
    delete fullConfig.extends;

    await writeFormattedJSON(fullConfig, configFilePath);
  });
}

async function getGitBranch(): Promise<string> {
  const asyncExec = promisify(exec);
  const { stdout } = await asyncExec('git rev-parse --abbrev-ref HEAD');
  return stdout.trim();
}

async function patchPackageJSON(packageJSONPath: string, gitPkgURLs: PlainObject<string>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const packageJSON = require(packageJSONPath) as PackageJSON;

  // we don't care about it and it's got a relative path that might not play well on vercel
  delete packageJSON.volta;

  // replace the versions of all `@sentry/x` packages (the ones from this repo, at least) with the appropriate URL, in
  // both regular and dev dependencies
  for (const depName in packageJSON.dependencies) {
    if (depName in gitPkgURLs) {
      packageJSON.dependencies[depName] = gitPkgURLs[depName];
    }
  }
  for (const depName in packageJSON.devDependencies) {
    if (depName in gitPkgURLs) {
      packageJSON.devDependencies[depName] = gitPkgURLs[depName];
    }
  }

  await writeFormattedJSON(packageJSON, packageJSONPath);
}

async function writeFormattedJSON(content: PlainObject, destinationPath: string): Promise<void> {
  const eslintConfig: PlainObject = {
    fix: true,
    overrideConfig: {
      plugins: ['jsonc'],
      extends: ['plugin:jsonc/base'],
      overrides: [
        {
          files: ['*.json'],
          rules: {
            'jsonc/array-bracket-newline': [
              'error',
              {
                multiline: true,
                minItems: 1,
              },
            ],
            'jsonc/object-curly-newline': [
              'error',
              {
                ObjectExpression: { multiline: true, minProperties: 1 },
              },
            ],
            'jsonc/array-element-newline': [
              'error',
              {
                multiline: true,
                minItems: 1,
              },
            ],
            'jsonc/object-property-newline': ['error'],
            'jsonc/indent': ['error', 2],
            'no-trailing-spaces': 'error',
          },
        },
      ],
    },
  };

  return await prettier
    .resolveConfigFile()
    .then(configFilepath => prettier.resolveConfig(configFilepath as string))
    .then(options => prettier.format(JSON.stringify(content), { ...options, parser: 'json' } as prettier.Options))
    .then(finalOutput =>
      fs.writeFile(destinationPath, finalOutput, async () => {
        console.log('rewriting', destinationPath);

        await new eslint.ESLint(eslintConfig)
          .lintFiles([destinationPath])
          .then(lintResults => eslint.ESLint.outputFixes(lintResults))
          .then(() =>
            // eslint-disable-next-line no-console
            console.log(`Done rewriting \`${destinationPath}\`.`),
          )
          .catch(err => {
            // eslint-disable-next-line no-console
            console.log(`Error using eslint to format ${destinationPath}: ${err}`);
          });
      }),
    )
    .catch(err => {
      // eslint-disable-next-line no-console
      console.log(`Error using prettier to format ${destinationPath}: ${err}`);
    });
}

void doPatching();
