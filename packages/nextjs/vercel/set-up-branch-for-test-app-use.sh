# SET UP BRANCH FOR USE IN VERCEL-DEPLOYED TEST APPS

NEXTJS_SDK_DIR=$(pwd)

# cd into repo root
cd ../..

# make sure we're dealing with a clean repo
STASHED_CHANGES=$(git status --porcelain)
if [ -n "${STASHED_CHANGES}" ]; then
  git stash -u
fi

# get rid of irrelevant packages to speed up deploy process and commit the result
for package in "angular" "ember" "eslint-config-sdk" "eslint-plugin-sdk" "gatsby" "serverless" "vue" "wasm"; do
  echo "deleting ${package}"
  rm -rf packages/${package}
done
git add .
git commit -m "delete unneeded packages"

# restore working directory, if necessary
if [ -n "${STASHED_CHANGES}" ]; then
  git stash pop
fi

cd $NEXTJS_SDK_DIR
