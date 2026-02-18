let Gpio;
if (process.platform === 'linux') {
  Gpio = require('onoff').Gpio;
} else {
  // Simple mock for macOS/Windows
  Gpio = function () {
    return {
      writeSync: () => console.log("Mock GPIO write"),
      readSync: () => 0,
      unexport: () => {}
    };
  };
}

module.exports = Gpio;
