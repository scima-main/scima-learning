cp -r site/home*/. minified/home && find minified/home -type f \( -name "*.html" -o -name "*.css" -o -name "*.js" \) -exec sh -c 'minify --html-keep-quotes -o "$1" "$1" || minify -o "$1" "$1"' _ {} \;
# The backend is canonical at site/backend; minified/backend is a plain
# generated copy for the deploy bundle (no minification — Python ships as
# source). Re-sync it here so the two can never drift again.
rm -rf minified/backend && cp -r site/backend minified/backend
find minified/backend \( -name __pycache__ -o -name .pytest_cache \) -prune -exec rm -rf {} +
