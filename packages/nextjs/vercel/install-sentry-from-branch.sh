# SCRIPT TO INCLUDE IN A VERCEL-DEPLOYED PROJECT SO THAT IT USES A BRANCH FROM THE SDK REPO

# CUSTOM INSTALL COMMAND FOR PROJECT ON VERCEL: yarn && source .sentry/install-sentry-from-branch.sh

local PROJECT_DIR=$(pwd)

source .sentry/set-branch-name.sh
git clone https://github.com/getsentry/sentry-javascript#${BRANCH_NAME}
cd sentry-javascript
yarn --prod false
yarn build
cd $PROJECT_DIR

# for abs_package_path in ${PROJECT_DIR}/sentry-javascript/packages/*; do
for abs_package_path in sentry-javascript/packages/*; do
  local package=$(basename $abs_package_path)

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
