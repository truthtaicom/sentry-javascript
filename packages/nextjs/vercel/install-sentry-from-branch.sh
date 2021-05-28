# SCRIPT TO INCLUDE IN A VERCEL-DEPLOYED PROJECT SO THAT IT USES A BRANCH FROM THE SDK REPO

# CUSTOM INSTALL COMMAND FOR PROJECT ON VERCEL: yarn && source .sentry/install-sentry-from-branch.sh
# CUSTOM INSTALL COMMAND FOR PROJECT ON VERCEL: source .sentry/install-sentry-from-branch.sh && yarn

PROJECT_DIR=$(pwd)

# set BRANCH_NAME as an environment variable
source .sentry/set-branch-name.sh

# clone and build the SDK
echo " "
echo "Cloning SDK repo"
git clone https://github.com/getsentry/sentry-javascript.git
cd sentry-javascript
git checkout $BRANCH_NAME
echo "Latest commit: $(git log --format="%C(auto) %h - %s" | head -n 1)"
echo " "
echo "Installing SDK dependencies"
yarn --prod false
echo " "
echo "Building SDK"
yarn build:es5
yarn build:esm
cd $PROJECT_DIR

# Add built SDK as a file dependency. This has the side effect of forcing yarn to install all of the other dependencies,
# saving us the trouble of needing to call `yarn` separately after this
echo " "
echo "Substituting local SDK for published one and installing project dependencies"
echo "yarn add file:sentry-javascript/packages/nextjs"
yarn add file:sentry-javascript/packages/nextjs

# In case for any reason we ever need to link the local SDK rather than adding it as a file dependency:

# for abs_package_path in ${PROJECT_DIR}/sentry-javascript/packages/*; do

# # link the built packages into project dependencies
# for abs_package_path in sentry-javascript/packages/*; do
#   package=$(basename $abs_package_path)

#   # this one will error out because it's not called @sentry/typescript, it's
#   # called @sentry-internal/typescript, but we don't need it, so just move on
#   if [ "$package" = "typescript" ]; then
#     continue
#   fi

#   echo " "
#   echo "Linking @sentry/${package}"

#   cd $abs_package_path
#   yarn link

#   cd $PROJECT_DIR
#   yarn link "@sentry/$package"
# done

# # These aren't in the repo and therefore have to be done separately (we link these even though they're not in the repo
# # because the branch might specify a different version of either than the published SDK does)
# for package in "cli" "webpack-plugin"; do

#   echo " "
#   echo "Linking @sentry/${package}"

#   cd sentry-javascript/node_modules/@sentry/$package
#   yarn link

#   cd $PROJECT_DIR
#   yarn link "@sentry/$package"
# done
