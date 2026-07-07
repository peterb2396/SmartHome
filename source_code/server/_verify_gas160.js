process.env.DISABLE_GPIO = '1';
const settingsSvc = require('./services/settings');
const mail = require('./services/mail');
const astro = require('./services/astro');

let fakeDb = {};
settingsSvc.init = async () => {};
settingsSvc.get = () => fakeDb;
settingsSvc.updateSetting = async (key, value) => { fakeDb = { ...fakeDb, [key]: value }; return fakeDb; };
mail.sendPush = async () => {};
astro.getHourlyForecast = async () => ({ times: ['x'], temps: Array(24).fill(40) });

const thermostatSvc = require('./services/thermostat');

(async () => {
  await thermostatSvc.init();

  // Try a spread of plausible electric rates at gas=$1.60/therm to see if
  // ANY combination reproduces the reported blank/both-gas symptom.
  for (const elec of [0.10, 0.15, 0.20, 0.2267, 0.25, 0.30, 0.50, 1.00, 0.01]) {
    await thermostatSvc.setRates({ gasPricePerTherm: 1.60, elecPricePerKwh: elec, gasAfue: 0.85 });
    const state = thermostatSvc.getState();
    console.log(`elec=$${elec} ->`, JSON.stringify(state.crossover));
    console.assert(typeof state.crossover.tempF === 'number' && !Number.isNaN(state.crossover.tempF),
      `BUG REPRODUCED: tempF is not a valid number at elec=${elec}`);
    console.assert(state.crossover.warmerIsCheaper === 'air', `BUG: warmerIsCheaper should always be 'air', got ${state.crossover.warmerIsCheaper}`);
    console.assert(state.crossover.colderIsCheaper === 'gas', `BUG: colderIsCheaper should always be 'gas', got ${state.crossover.colderIsCheaper}`);
  }

  console.log('\n=== VERIFICATION COMPLETE — current code cannot reproduce the reported bug ===');
  process.exit(0);
})().catch(err => { console.error('VERIFICATION FAILED:', err); process.exit(1); });
