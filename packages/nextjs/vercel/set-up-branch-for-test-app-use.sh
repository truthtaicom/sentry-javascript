# SET UP BRANCH FOR USE IN VERCEL-DEPLOYED TEST APPS

NEXTJS_SDK_DIR=$(pwd)

# cd into repo root
cd ../..

# make sure we're dealing with a clean repo
git stash -u

# get rid of irrelevant packages to speed up deploy process and commit the result
for package in "angular" "ember" "eslint-config-sdk" "eslint-plugin-sdk" "gatsby" "serverless" "vue" "wasm"; do
  echo "deleting ${package}"
  rm -rf packages/${package}
done
git add .
git commit -m "delete unneeded packages"

# restore working directory
git stash pop

cd $NEXTJS_SDK_DIR
