# SCRIPT TO INCLUDE IN A VERCEL-DEPLOYED PROJECT SO THAT IT USES A BRANCH FROM THE SDK REPO

# CUSTOM INSTALL COMMAND FOR PROJECT ON VERCEL: yarn && source .sentry/install-sentry-from-branch.sh

PROJECT_DIR=$(pwd)

# set BRANCH_NAME as an environment variable
source .sentry/set-branch-name.sh

# clone and build the SDK
git clone https://github.com/getsentry/sentry-javascript.git
cd sentry-javascript
git checkout $BRANCH_NAME
yarn --prod false
yarn build:es5
cd $PROJECT_DIR

# for abs_package_path in ${PROJECT_DIR}/sentry-javascript/packages/*; do

# link the built packages into project dependencies
for abs_package_path in sentry-javascript/packages/*; do
  package=$(basename $abs_package_path)

  # this one will error out because it's not called @sentry/typescript, it's
  # called @sentry-internal/typescript, but we don't need it, so just move on
  if [ "$package" = "typescript" ]; then
    continue
  fi

  echo " "
  echo "Linking @sentry/${package}"

  cd $abs_package_path
  yarn link

  cd $PROJECT_DIR
  yarn link "@sentry/$package"
done

# These aren't in the repo and therefore have to be done separately
for package in "cli" "webpack-plugin"; do

  echo " "
  echo "Linking @sentry/${package}"

  cd sentry-javascript/node_modules/@sentry/$package
  yarn link

  cd $PROJECT_DIR
  yarn link "@sentry/$package"
done
