var browserify = require('browserify')
var b = browserify()
b.add('./lib/index.js')
b.plugin(require('tinyify'))
var globalShim = require('browserify-global-shim').configure({
  // 将UMD里的某个属性放到全局(window)属性里
  'default': 'XPeer'
})
b.transform(globalShim).bundle().pipe(process.stdout)

// "bundle": "tsc && browserify -p tinyify lib/index.js -o out/xpeer.bundle.js"