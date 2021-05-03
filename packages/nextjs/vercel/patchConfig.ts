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
// import * as ts from 'typescript';
import { promisify } from 'util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlainObject<T = any> = { [key: string]: T };
type StringObject = PlainObject<string>;

type PackageJSON = { name: string; dependencies: StringObject; devDependencies: StringObject; volta?: StringObject };

async function asyncForEach<T>(arr: T[], callback: (element: T, index: number, arr: T[]) => unknown): Promise<void> {
  for (let i = 0; i < arr.length; i++) {
    await callback(arr[i], i, arr);
  }
}

async function doPatching(): Promise<void> {
  // const packageNames = fs.readdirSync('../../packages').filter(name => {
  //   const packagePath = path.resolve('../../packages', name);
  //   return fs.statSync(packagePath).isDirectory();
  // });

  const packagesDir = path.resolve('../../packages');

  // get the names of all the packages
  const packageDirNames: string[] = fs
    .readdirSync(packagesDir)
    .map(fileOrDir => path.resolve(packagesDir, fileOrDir))
    .filter(fileOrDirPath => fs.statSync(fileOrDirPath).isDirectory())
    .map(dirAbsPath => path.basename(dirAbsPath));

  // compute a gitPkg URL for each, and cache it (this is in a separate loop because we'll need these from the first
  // iteration of the next loop)
  const gitBranch = await getGitBranch();
  const gitPkgURLs: StringObject = {};
  packageDirNames.forEach(dirName => {
    const npmName = ['eslint-config-sdk', 'eslint-plugin-sdk', 'typescript'].includes(dirName)
      ? `@sentry-internal/${dirName}`
      : `@sentry/${dirName}`;
    gitPkgURLs[npmName] = `https://gitpkg.now.sh/getsentry/sentry-javascript/packages/${dirName}?${gitBranch}`;
  });

  // make the necessary changes in each package
  await asyncForEach(packageDirNames, async dirName => {
    const packageJSONPath = path.resolve(packagesDir, dirName, 'package.json');

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

    await prettier
      .resolveConfigFile()
      .then(configFilepath => prettier.resolveConfig(configFilepath as string))
      .then(options => prettier.format(JSON.stringify(packageJSON), { ...options, parser: 'json' } as prettier.Options))
      .then(finalOutput =>
        fs.writeFile(packageJSONPath, finalOutput, () => {
          void new eslint.ESLint(eslintConfig)
            .lintFiles([packageJSONPath])
            .then(lintResults => eslint.ESLint.outputFixes(lintResults))
            .then(() =>
              // eslint-disable-next-line no-console
              console.log(`Done rewriting \`package.json\` for @sentry/${dirName}.`),
            )
            .catch(err => {
              // eslint-disable-next-line no-console
              console.log(`Error using eslint to format ${packageJSONPath}: ${err}`);
            });
        }),
      )
      .catch(err => {
        // eslint-disable-next-line no-console
        console.log(`Error using prettier to format ${packageJSONPath}: ${err}`);
      });
  });
}

async function getGitBranch(): Promise<string> {
  const asyncExec = promisify(exec);
  const { stdout } = await asyncExec('git rev-parse --abbrev-ref HEAD');
  return stdout.trim();
}

void doPatching();
