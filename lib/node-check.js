// Musí byť prvý import v server.js: pri starom Node skončíme zrozumiteľnou chybou skôr,
// než sa načítajú moduly, ktoré používajú novšie funkcie (fetch, AbortSignal.any...)
const major = Number(process.versions.node.split('.')[0])
if (major < 20) {
    console.error(`Offline Stremio needs Node.js 20 or newer, this is ${process.version}.`)
    console.error('macOS: brew install node  (or the installer from https://nodejs.org)')
    process.exit(1)
}
