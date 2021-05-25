settings for vercel project:

build command: `source buildOnVercel.sh`
install command `yarn cache clean && yarn --prod false` (not clear if the cache clean is necessary but prod-false is)

change testapp's package.json -> dependencies -> @sentry/nextjs to "https://gitpkg.now.sh/getsentry/sentry-javascript/packages/nextjs?<branch name>"


copy the `buildOnVercel.sh` script here into the root level of your testapp (or elsewhere, but then change the build command above accordingly)
