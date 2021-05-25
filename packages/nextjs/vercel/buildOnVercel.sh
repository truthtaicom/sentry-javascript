ls -l node_modules/@sentry

# yarn list --pattern npm-run-all
# yarn list --pattern \@types

# echo "  "
# echo "CD-ING INTO NODE_MODULES/@SENTRY/NEXTJS"
# echo "  "
# cd node_modules/@sentry/nextjs

# cat package.json

# echo "  "
# echo "INSTALLING SDK DEPENDENCIES"
# echo "  "

# this makes it install dev dependencies, which we need for building
# yarn --prod false

# ls -l node_modules/@sentry
# yarn list --pattern \@types

yarn list --depth=0

# yarn add npm-run-all
# yarn list --depth=0
# yarn list --pattern npm-run-all

# for package in "types" "utils" "hub" "minimal" "core" "browser" "tracing" "node" "react" "integrations"; do
for package in "cli" "webpack-plugin" "types" "utils" "hub" "minimal" "core" "browser" "tracing" "node" "react" "integrations" "nextjs"; do
  # ${var-name:u} converts to uppercase in zsh (can also do ${(U)var-name},
  # and the same works with l/L for lowercase)
  echo "  "
  echo "***** @SENTRY/${package:u} *****"
  echo "  "

  # this is the project's main `node_moules` folder
  cd node_modules/@sentry/${package}

  # we need dev dependencies in order to build the package
  yarn --prod false

  # Each package will put other sentry packages in its node_modules. In order to avoid building a bunch of copies of the same package,
  # we always want it to use the copy in the project's main node_moudules, but the package we're building won't look to its siblings
  # if it has the necessary thing itself. So we make sure it doesn't.
  rm -rf node_modules/@sentry

  # this errors for a few packages which don't have such commands, but that’s fine (not using `yarn build` here in order to avoid
  # creating rollup bundles, which are slowwwwwww)
  yarn build:es5
  yarn build:esm

  # back to the project root
  cd -
done

# yarn list --pattern \@types
# yarn why \@types/cookie
# ls -l node_modules/@sentry
# ls -l node_modules/@sentry/react
# ls -l node_modules/@sentry/react/
# ls -l node_modules/@sentry/nextjs/node_modules/@sentry
# ls -l node_modules/@sentry/node/node_modules/@types

# echo "  "
# echo "BUILDING SDK"
# echo "(Hint: We need to do this because we're installing it straight from a GH branch, not from npm.)"
# echo "  "
# yarn build
# echo "NEXTJS SDK BUILT SUCCESSFULLY"
# echo "RETURNING TO PROJECT ROOT"
# cd ../../..

echo "  "
echo "BUILDING PROJECT"
echo "  "
yarn build
