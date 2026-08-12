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
