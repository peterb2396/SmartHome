const router = require('express').Router();
const dbConnect = require('../db/dbConnect');

// Services that need to start on boot
const astro    = require('../services/astro');
const calendar = require('../services/calendar');
const settings = require('../services/settings');
const vehicleQueue = require('../services/vehicleQueue');

// GPIO (only on Linux)
const gpio = require('../services/gpio');

// Route modules
const smarthome = require('./smarthome');
const vehicle   = require('./vehicle');
const presence  = require('./presence');
const auth      = require('./auth');
const finance   = require('./finance');
const misc      = require('./misc');

// Boot sequence
(async () => {
  await dbConnect();
  await settings.init();
  await astro.init();
  gpio.init();
})();

router.use(smarthome);
router.use(vehicle);
router.use(presence);
router.use(auth);
router.use(finance);
router.use(misc);

module.exports = router;
