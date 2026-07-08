const router = require('express').Router();
const dbConnect = require('../db/dbConnect');

// Services that need to start on boot
const astro    = require('../services/astro');
const settings = require('../services/settings');
const gpio     = require('../services/gpio');
const cameraSvc = require('../services/camera');
const thermostat = require('../services/thermostat');
const maintenance = require('../services/maintenance');

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

// Boot sequence
(async () => {
  await dbConnect();
  await settings.init();
  await astro.init();
  gpio.init();
  await thermostat.init();
  maintenance.init();
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

module.exports = router;
