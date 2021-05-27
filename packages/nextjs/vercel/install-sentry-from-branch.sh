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

# get rid of existing installed SDK packages, leaving the outer directory
echo "rm -rf node_modules/@sentry/*"
rm -rf node_modules/@sentry/*

# # cd into that directory
# echo "cd node_modules/@sentry"
# cd node_modules/@sentry

# In `sentry-javascript/node_modules/@sentry`, all packages aside from `cli` and `webpack-plugin` are symlinks to the
# built packages in `sentry-javascript/packages`. Copying using `-L` follows the symlinks and you end up with copies of
# the real versions of said packages rather than copies of the symlinks. We also know that
# `sentry-javascript/node_modules` has every dependency we need, so copying the entire `node_modules` directory kilss
# two birds with one stone. By putting it in `<project-root>/node_modules/@sentry`, we guarantee that the resolver will
# hit it before it hits the main `node_modules`, so even if there are duplicate packages, we know we'll get the right
# version.
echo "cp -r -L sentry-javascript/node_modules/ node_modules/@sentry"
cp -r -L sentry-javascript/node_modules/ node_modules/@sentry

# The now-materialzed built packages are currently in `<project-root>/node_modules/@sentry/node_modules/@sentry`, but
# where we really want them is `<project-root>/node_modules/@sentry`, since that's where the originals we deleted were
echo "mv node_modules/@sentry/node_modules/@sentry/* node_modules/@sentry"
mv node_modules/@sentry/node_modules/@sentry/* node_modules/@sentry

ls -l node_modules/@sentry

# # The final step is to delete the now-empty
# echo "rm -rf node_modules/@sentry"
# rm -rf node_modules/@sentry

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

# # These aren't in the repo and therefore have to be done separately
# for package in "cli" "webpack-plugin"; do

#   echo " "
#   echo "Linking @sentry/${package}"

#   cd sentry-javascript/node_modules/@sentry/$package
#   yarn link

#   cd $PROJECT_DIR
#   yarn link "@sentry/$package"
# done
