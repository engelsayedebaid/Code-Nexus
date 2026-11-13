// Local Nexus build: reuse the already-installed Electron 43.8.7 dist instead of
// re-downloading ~110MB over this machine's flaky link.
const path = require('node:path')
const base = require('./electron-builder.config.cjs')

module.exports = {
  ...base,
  electronDist: path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist')
}
