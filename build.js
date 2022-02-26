var browserify = require('browserify')
var b = browserify({
  standalone: 'XPeer'
})
b.add('./lib/browserify.js')
b.bundle()
  .pipe(process.stdout)

// "bundle": "tsc && browserify --source -p tinyify lib/index.js -o out/xpeer.bundle.js"