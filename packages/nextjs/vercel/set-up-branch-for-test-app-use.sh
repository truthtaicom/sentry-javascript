# SET UP BRANCH FOR USE IN VERCEL-DEPLOYED TEST APPS

NEXTJS_SDK_DIR=$(pwd)

# cd into repo root
cd ../..

# make sure we're dealing with a clean repo
STASHED_CHANGES=$(git status --porcelain)
if [ -n "${STASHED_CHANGES}" ]; then
  git stash -u
fi

# if this hasn't already been done, get rid of irrelevant packages to speed up deploy process and then commit the result
PACKAGES_DELETED=false
for package in "angular" "ember" "eslint-config-sdk" "eslint-plugin-sdk" "gatsby" "serverless" "vue" "wasm"; do
  if [ -d packages/${package} ]; then
    echo "deleting ${package}"
    rm -rf packages/${package}
    PACKAGES_DELETED=true
  fi
done

if [ $PACKAGES_DELETED = true ]; then
  echo "committing deletions"
  git add .
  git commit -m "delete unneeded packages"
fi

# restore working directory, if necessary
if [ -n "${STASHED_CHANGES}" ]; then
  git stash pop
fi

cd $NEXTJS_SDK_DIR
