# MAKE TEST APP USE THIS BRANCH
# CALL THIS WITH PATH-TO-TEST-APP AS THE FIRST/ONLY ARGUMENT

NEXTJS_SDK_DIR=$(pwd)
TEST_APP_DIR=$1
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

cd $TEST_APP_DIR

# make sure we're dealing with a clean repo
STASHED_CHANGES=$(git status --porcelain)
if [ -n "${STASHED_CHANGES}" ]; then
  git stash -u
fi

rm -rf .sentry
mkdir .sentry

# set up scripts for use in vercel deployment
cp $NEXTJS_SDK_DIR/vercel/install-sentry-from-branch.sh .sentry
echo "export BRANCH_NAME=${BRANCH_NAME}" >>.sentry/set-branch-name.sh

git add .
git commit -m "add scripts for using ${BRANCH_NAME} branch of @sentry/nextjs"

# restore working directory, if necessary
if [ -n "${STASHED_CHANGES}" ]; then
  git stash pop
fi

cd $NEXTJS_SDK_DIR

echo "SUCCESS!"
echo "Your project will now use this branch of the SDK repo when deployed to Vercel. If you haven't already, go to your project settings and set a custom install command:"
echo "  yarn && source .sentry/install-sentry-from-branch.sh
"
