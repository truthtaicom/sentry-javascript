settings for vercel project:

build command: `source buildOnVercel.sh`
install command `yarn cache clean && yarn --prod false` (not clear if the cache clean is necessary but prod-false is)

change testapp's package.json -> dependencies -> @sentry/nextjs to "https://gitpkg.now.sh/getsentry/sentry-javascript/packages/nextjs?<branch name>"


copy the `buildOnVercel.sh` script here into the root level of your testapp (or elsewhere, but then change the build command above accordingly)

error during the `[1/4] Resolving packages...` step:
error https://gitpkg.now.sh/getsentry/sentry-javascript/packages/utils?kmclb-vercel-dependency-test: Extracting tar content of undefined failed, the file appears to be corrupt: "ENOENT: no such file or directory, open '/vercel/.cache/yarn/v6/.tmp/bc4e2c50304b2e4018174055e7732fc8/src/memo.ts'"
just hit `redeploy` a few times until it gets to step 2. At that point you can leave it.
