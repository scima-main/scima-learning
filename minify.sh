cp -r site/home*/. minified/home && find minified -type f \( -name "*.html" -o -name "*.css" -o -name "*.js" \) -exec sh -c 'minify -o "$1" "$1"' _ {} \;
