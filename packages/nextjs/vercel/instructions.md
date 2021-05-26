once per branch: set-up-branch-for-test-app-use.sh
yarn vercel:branch

once per test-app: make-project-use-current-branch.sh (requires ^^, need to redo ^^ from new branch to switch branches)
yarn vercel:testapp <path/to/testapp>

run on vercel, not locally: install-sentry-from-branch.sh
