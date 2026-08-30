const router = require('express').Router();
const dbConnect = require('../db/dbConnect');

// Services that need to start on boot
const astro    = require('../services/astro');
const settings = require('../services/settings');
const gpio     = require('../services/gpio');
const cameraSvc = require('../services/camera');
const thermostat = require('../services/thermostat');
const maintenance = require('../services/maintenance');
const logStream = require('../services/logStream');
const rs485 = require('../services/rs485');
const nodeRegistry = require('../services/nodeRegistry');
const faultLed = require('../services/faultLed');
const sound = require('../services/sound');
const zoneAudioHardware = require('../services/zoneAudioHardware');
const spotify = require('../services/spotify');
const lutron = require('../services/lutron');

// Route modules
const smarthome = require('./smarthome');
const vehicle   = require('./vehicle');
const presence  = require('./presence');
const auth      = require('./auth');
const finance   = require('./finance');
const misc      = require('./misc');
const camera    = require('./camera');
const thermostatRoutes  = require('./thermostat');
const maintenanceRoutes = require('./maintenance');
const consoleRoutes     = require('./console');
const logRoutes         = require('./logs');
const soundRoutes       = require('./sound');
const lutronRoutes      = require('./lutron');

// Installed synchronously, before anything else logs, so the Console
// terminal's history starts from the very first boot message.
logStream.install();

// Boot sequence
(async () => {
  await dbConnect();
  await settings.init();
  await astro.init();
  gpio.init();
  await thermostat.init();
  maintenance.init();
  await sound.init();
  // Direct-I2C zone audio driver — see that file's header for why this
  // exists alongside (not instead of) the RS485 zoneAudio node path below.
  // A given zone only ever gets driven by whichever transport actually has
  // real hardware wired for it; running both unconditionally is harmless —
  // a zone with no I2C hardware present just fails its reads/writes
  // silently into this file's own error logging, same as any other
  // not-yet-wired sensor elsewhere in this app.
  zoneAudioHardware.init();
  spotify.init();
  // lutron.init() disabled — lights/fans are back on SmartThings and the
  // physical bridge connection was flapping (repeated connect/disconnect),
  // spamming push notifications on every flap. Not calling init() means it
  // never opens the Telnet connection at all, so no more reconnect churn.
  rs485.init(() => nodeRegistry.getState().configured);
  faultLed.init();
  await cameraSvc.initRecorders(); // start recording for all enabled cameras
})();

router.use(smarthome);
router.use(vehicle);
router.use(presence);
router.use(auth);
router.use(finance);
router.use(misc);
router.use(camera);
router.use(thermostatRoutes);
router.use(maintenanceRoutes);
router.use(consoleRoutes);
router.use(logRoutes);
router.use(soundRoutes);
router.use(lutronRoutes);

module.exports = router;
