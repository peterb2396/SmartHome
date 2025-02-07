  var express = require('express');
  const dbConnect = require("./db/dbConnect");
  const User = require("./db/userModel.js");
  const mongoose = require('mongoose');
  const cron = require('node-cron');
  var router = express.Router();
  require('dotenv').config();
  var axios = require('axios')
  const bcrypt = require("bcrypt");
  const nodemailer = require('nodemailer');
  const crypto = require("crypto");
  const qs = require('qs'); // Import qs for URL encoding
  const moment = require('moment');

  // To determine sunset
  const lat = 41.722034;  // wellsboro
  const lng = -77.263969; // 
  const apiUrl = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0`;


  async function isAfterSunset() {
    try {
      // Fetch the sunset data
      const response = await axios.get(apiUrl);
      const sunsetTime = response.data.results.sunset;  // Sunset time in UTC
  
      // Convert sunset time from UTC to Eastern Time
      let sunsetMoment = moment.utc(sunsetTime).subtract(5, 'hours');
  
      // Get the current time in UTC and convert to Eastern Time
      let currentTime = moment.utc().subtract(5, 'hours');
  
      // Ensure sunsetMoment is using today's date
      sunsetMoment = sunsetMoment.date(currentTime.date());
  
      // Check if current time is after sunset
      return currentTime.isAfter(sunsetMoment);
  
    } catch (error) {
      console.error('Error fetching sunset data:', error);
    }
  }
  
  
  
  


  // DB connection
  dbConnect()

  

  // Tuya (GSPOTS)
  const ACCESS_ID = process.env.ACCESS_ID
  const ACCESS_SECRET = process.env.ACCESS_SECRET
  const BASE_URL = "https://openapi.tuyaus.com";
  
  let accessToken = null;
  let tokenExpiry = null;

  // Timer to shutoff temp lights
  temp_light_timeout = null

  // Settings from frontend
  let settings = {}
  const settingsSchema = new mongoose.Schema({}, { strict: false });
  const Settings = mongoose.model('Settings', settingsSchema);

  async function updateSettings() {
    settings = await Settings.findOne();

  } 
  let accessToken2 = null;

  // Call once
  (async () => {
    await updateSettings()

    // Store token info (access and expiration)
    accessToken2 = settings.accessToken
    if (!accessToken2) accessToken2 = await getAccessToken();

    maintainUsers()

  })();

  // Use the settings to get the access token.
  const clientId = process.env.SMART_CLIENT_ID;
  const clientSecret = process.env.SMART_CLIENT_SECRET;

  

  let tokenExpiration = 0;

  
  // Update a setting
  async function updateSetting(key, value) {
    const result = await Settings.findOneAndUpdate(
        {}, // Find the existing settings document
        { [key]: value }, // Update the specific key dynamically
        { upsert: true, new: true, setDefaultsOnInsert: true } // Create if not exists
    );

    settings = result.toObject()
    return settings;


}


// API route to update a setting
router.post("/settings", async (req, res) => {
  try {
      const { key, value } = req.body;
      if (!key) {
          return res.status(400).json({ error: "Key is required" });
      }

      const updatedSettings = await updateSetting(key, value);
      res.json({ success: true, settings: updatedSettings });
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

router.get("/settings", async (req, res) => {
  // Create a copy of the settings object without the accessToken and refreshToken
  const { accessToken, refreshToken, ...settingsWithoutTokens } = settings;
  delete settingsWithoutTokens["$isNew"]
  delete settingsWithoutTokens["$__"]
  delete settingsWithoutTokens["_doc"]


  // Send the settings without accessToken and refreshToken
  res.json(settingsWithoutTokens);
});



// List devices
// List devices
async function listDevices() {
  
  try {
    // Fetch the list of devices
    const response = await axios.get('https://api.smartthings.com/v1/devices', {
      headers: {
        Authorization: `Bearer ${accessToken2}`,
      },
    });

    // Fetch status for each device
    const devicesWithStatus = await Promise.all(
      response.data.items.map(async (device) => {
        try {
          const statusResponse = await axios.get(`https://api.smartthings.com/v1/devices/${device.deviceId}/status`, {
            headers: {
              Authorization: `Bearer ${accessToken2}`,
            },
          });
          // Merge the status into the device object
          return { ...device, status: statusResponse.data };
        } catch (statusError) {
          console.error(`Error fetching status for device ${device.deviceId}:`, statusError);
          return device; // Return the device without status if an error occurs
        }
      })
    );

    return devicesWithStatus;
  } catch (error) {
    console.error('Error listing devices:', error);
    throw new Error('Failed to list devices');
  }
}


// Function to convert a user's inputted devices to device objects
async function makeDevices(lightDevices) {
  const devices = lightDevices || await listDevices();
  let lights;

  try {
      lights = devices.filter(device =>
          device.components.some(component =>
              component.capabilities.some(cap => cap.id === "switch")
          )
      );
  } catch (error) {
      // All devices to filter from
      let baseArray = await listDevices();
      baseArray = baseArray.filter(device =>
          device.components.some(component =>
              component.capabilities.some(cap => cap.id === "switch")
          )
      );

      // Provided filters
      const filterArray = devices;

      // Return device objects matching user's input: could be a room id, a device name, or a device id
      lights = baseArray.filter(device =>
          filterArray.some(filter =>
              (filter.deviceId && filter.deviceId === device.deviceId) ||
              (filter.roomId && filter.roomId === device.roomId) ||
              (filter.label && filter.label === device.label)
          )
      );

      // Include level field if present in input
      lights = lights.map(device => {
          const match = filterArray.find(filter => filter.deviceId === device.deviceId);
          return match && match.level !== undefined
              ? { ...device, level: match.level }
              : device;
      });
  }

  return lights;
}

async function validatePassword(password)
{
  if (password !== process.env.PASSWORD) 
    {
      // See if we provided a value which is the _id string for any user in the db
      try {
        const user = await User
        .findOne({ _id: password })
  
        if (!user) return false
        return true
  
      } catch (error) {
        return false
      }
  
  
    }
    else return true
}

// Turn off or on all or some lights
// can provide SmartThings device objects,
// or an array of device IDs, room IDs, or device labels.
// Optionally provide a level for each light by including a level field.
// * if this doesnt work, it may be because we need to provide an array of objects rather than just raw strings.
async function lights(lightDevices = null, on = true, password, level = 100) {
  const val = await validatePassword(password)
  if (!val) return


  try {

    // const lights = await makeDevices(lightDevices);
    const lights = lightDevices || await listDevices();

    for (const light of lights) {
      const deviceId = light.deviceId || light;

      await axios.post(
        `https://api.smartthings.com/v1/devices/${deviceId}/commands`,
        {
          commands: [
            {
              capability: 'switch',
              command: on ? 'on' : 'off',
            },
            {
              capability: "switchLevel",  // Correct capability name
              command: "setLevel",       // Correct command name
              arguments: [on ? (light.level ? light.level : level) : 0], // Needs to be an array
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken2}`,
          },
        }
      );
    }
  } catch (error) {
    if (error.response.status === 429)
    {
      console.log('Too many requests. Trying again in ', error.response.headers['x-ratelimit-reset']);
      await new Promise(resolve => setTimeout(resolve, error.response.headers['x-ratelimit-reset']));
      return lights(lightDevices, on, password);
    }
    console.error('Error controlling lights:', error);
    throw new Error('Failed to control lights');
  }
}


  // Function to get all devices ( SmartThings )
  router.get('/list-devices', async (req, res) => {
    try {
      const devices = await listDevices();
      res.json(devices);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });


// Endpoint to control lights
router.post('/lights', async (req, res) => {
  const { devices, on, password, level } = req.body;

  try {
    await lights(devices, on, password, level);
    res.status(200).send('Lights controlled successfully');
  } catch (error) {
    console.error('Error in /control-lights endpoint:', error);
    res.status(500).send('Failed to control lights');
  }
});

  
  async function encryptStr(str, secret) {
    return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
  }
  
  // only for token work
  async function generateSignature(timestamp, signUrl, method, body = '') {
    const contentHash = crypto.createHash('sha256').update(body).digest('hex');
    const stringToSign = [method, contentHash, '', signUrl].join('\n');
    const signStr = ACCESS_ID + timestamp + stringToSign;
    const sign = await encryptStr(signStr, ACCESS_SECRET);
    return sign;
  }

  
// for control
async function generateSignatureGeneral(timestamp, signUrl, method, body = '') {
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');
  const stringToSign = [method, contentHash, '', signUrl].join('\n');

  // const signStr = ACCESS_ID + timestamp + stringToSign;
  
  const signStr = ACCESS_ID + accessToken + timestamp + stringToSign

  const sign = await encryptStr(signStr, ACCESS_SECRET);
  return sign;
}
  
  async function fetchAccessToken() {
    const timestamp = Date.now().toString();

    const sign = await generateSignature(timestamp, '/v1.0/token?grant_type=1', 'GET');

    const response = await axios.get(
      `${BASE_URL}/v1.0/token?grant_type=1`,
      {
        headers: {
          client_id: ACCESS_ID,
          sign: sign,
          t: timestamp,
          sign_method: "HMAC-SHA256",
        },
      }
    );
  
    if (response.data.success === false) {
      throw new Error(`Failed to fetch token: ${response.data.msg}`);
    }
  
    const { result } = response.data;
    accessToken = result.access_token;
    tokenExpiry = Date.now() + result.expire_time * 1000;
    //console.log("Access token fetched:", accessToken);
  }
  
  async function ensureAccessToken(req, res, next) {
    if (!accessToken || Date.now() >= tokenExpiry) {
      try {
        await fetchAccessToken();
      } catch (error) {
        console.error("Error fetching access token:", error);
        return res.status(500).json({ error: "Failed to fetch access token" });
      }
    }
    next();
  }

  // Control power of a smart plug
  // Uses controlDevice function
  async function powerPlug(password, device, on) {
    const body = JSON.stringify({
      commands: [
        { code: "switch_1", value: on }
      ]
    });

    const result = await controlDevice(password, device, body);
    return result;
  }
  
  // General device control: Pass the body
  async function controlDevice(password, device, body) {



    const val = await validatePassword(password)
    if (!val) return null

    // Get device id if we passed an index
    const devices = JSON.parse(process.env.DEVICES);
    const deviceId = Number.isInteger(Number(device)) ? devices[device] : device;


    const timestamp = Date.now().toString();
    
    const sign = await generateSignatureGeneral(timestamp, `/v1.0/devices/${deviceId}/commands`, 'POST', body);
    const response = await axios.post(
      `${BASE_URL}/v1.0/devices/${deviceId}/commands`,
      JSON.parse(body),
      {
        headers: {
          client_id: ACCESS_ID,
          access_token: accessToken,
          sign: sign,
          t: timestamp,
          sign_method: "HMAC-SHA256",
        },
      }
    );
    return response.data;
  }

  router.post("/leave", ensureAccessToken, async (req, res) => {
    let lightsOn = []
    // Get the latest settings
    await updateSettings();
    const temp_lights = settings.temp_lights.split(',').map(item => item.trim())

    try {
      // Turn on Milo's camera
      const result = await powerPlug(req.body.password, 1, true);
      if (!result) {
        res.status(401).send("UNAUTHORIZED");
        console.log("Unauthorized request received!");
        return;
      }
      
      const username = req.body.who ? req.body.who : "Anonymous"
      console.log(username, "left the house");

      // Remove the user from the usersHome list, in the db
      let usersHome = settings.usersHome
      usersHome = usersHome.filter(u => u !== username)

      await updateSetting('usersHome', usersHome);


      const homeEmpty = usersHome.length === 0
  
      // Fetch all devices and filter for light devices
      const allDevices = await listDevices();
      const lightDevices = allDevices.filter(device => 
        device.components.some(component => 
          component.capabilities.some(cap => cap.id === 'switch')
        )
      );
  
      // Store all lights that are currently on
      
      for (const device of lightDevices) {
  
        // Query the current state of each light (on/off)
        const lightState = await axios.get(
          `https://api.smartthings.com/v1/devices/${device.deviceId}/status`,
          {
            headers: {
              Authorization: `Bearer ${accessToken2}`,
            },
          }
        );
        // Check if the light is on, and if so, add it to the lightsOn array
        if (lightState.data.components.main.switch.switch.value === 'on') {
          lightsOn.push({label: device.label, deviceId: device.deviceId, roomId: device.roomId, level: lightState.data.components.main.switchLevel.level.value});
        }
      }

      // Store all lights that are on in the database
      updateSetting('lightsOn', lightsOn)

      // If this house is not empty, only include temp lights (dont turn lights off on people who are home)
      if (!homeEmpty)
      {
        lightsOn = lightsOn.filter(device =>
          temp_lights.includes(device.roomId) ||
          temp_lights.includes(device.deviceId) ||
          temp_lights.includes(device.label)
        );
      }
  
      console.log(homeEmpty? "All lights" : "Temp lights", "that are currently on:", lightsOn);
  
      // Turn off all the lights
      // This will also turn off the outdoor lights that we put on before we left
      // and it will turn them back on, to their same brightness, when we get to the driveway
      // What we need to do then, is set a delay to turn off any outdoor lights after 5 minutes.
      const password = req.body.password;
      await lights(lightsOn, false, password);
  
      // Send a success response
      res.json({ success: true });
    } catch (error) {
      console.error("Error processing leave request:", error);
      res.status(500).json({ error: "Failed to process leave request" });
    }
  });

  
  router.get("/cb", async (req, res) => {
    console.log("callback hit")
    res.json("callback hit")
  })

  router.post("/arrive", ensureAccessToken, async (req, res) => {
    // Get latest settings
    // await updateSettings(); adding the user to arrival will trigger this
    try {

        // Turn off Milo's camera
        const result = await powerPlug(req.body.password, 1, false);
        if (!result) {
            res.status(401).send("UNAUTHORIZED");
            console.log("Unauthorized request received");
            return;
        }

        const username = req.body.who ? req.body.who : "Anonymous"
        console.log(username, "arrived at the house");
        // Ensure settings.usersHome is an array
        if (!Array.isArray(settings.usersHome)) {
          settings.usersHome = [settings.usersHome];
        }
  

        // Add the new user to the array if they're not already in it
        if (!settings.usersHome.includes(username)) 
          await updateSetting('usersHome', [...settings.usersHome, username]);

        // Is it after sunset?
        const afterSunset = await isAfterSunset();


        // Turn on all the lights which were turned off when we left
        let lightsOn = settings.lightsOn

        // Extract filters (temp_lights can be a single string or an array)
        const temp_lights = settings.temp_lights.split(',').map(item => item.trim());

         // If it is after sunset, include all temp_lights from getDevices in the tempDevices.
         // This will turn on all lights when we arrive to see in the dark.
         if (afterSunset) {
          const allDevices = await listDevices();
          const tempDevicesAll = allDevices.filter(device =>
            temp_lights.includes(device.roomId) ||
            temp_lights.includes(device.deviceId) ||
            temp_lights.includes(device.label)
          );
          lightsOn.push(...tempDevicesAll);
      }

        console.log("Turning these lights back on:", lightsOn);
        const password = req.body.password;
        await lights(lightsOn, true, password);

        
        

        if (temp_lights) {
            // Find devices in lightsOn that match any of the provided values
            const tempDevices = lightsOn.filter(device =>
              temp_lights.includes(device.roomId) ||
              temp_lights.includes(device.deviceId) ||
              temp_lights.includes(device.label)
            );

           

            if (tempDevices.length > 0) {
                console.log(`Waiting ${settings.temp_mins || 0.1} minutes before turning off these devices:`, tempDevices);
                // clear the existing timeout (reset the timer)
                if (temp_light_timeout) clearTimeout(temp_light_timeout)

                temp_light_timeout = setTimeout(async () => {
                    console.log("Turning off temp lights:", tempDevices);
                    await lights(tempDevices, false, password);
                    temp_light_timeout = null
                }, (settings.temp_mins || 0.1) * 60 * 1000); // Convert minutes to milliseconds
            }
        }

        // Clear lightsOn after turning them back on
        // Now its in the database
        // lightsOn = [];
        updateSettings('lightsOn', [])

        // Send a success response
        res.json({ success: true });
    } catch (error) {
        console.error("Error processing arrive request:", error);
        res.status(500).json({ error: "Failed to process arrive request" });
    }
});



  
  
  router.post("/power", ensureAccessToken, async (req, res) => {
    
    try {
      const result = await powerPlug(req.body.password, req.body.deviceId, req.body.on);
      if (!result)
        {
          res.status(401).send("UNAUTHORIZED")
          console.log("Unauthorized request receieved")
          return
        }

        console.log(req.body.who? req.body.who : "Anonymous","executed power", req.body.on? "on for" : "off for", req.body.deviceId)
        
      res.json({ success: true, data: result });
    } catch (error) {
      console.error("Error powering device:", error);
      res.status(500).json({ error: "Failed to power device" });
    }
  });


  async function getDevices() {
    const timestamp = Date.now().toString();
    const sign = await generateSignatureGeneral(timestamp, `/v1.0/users/${process.env.UID}/devices`, 'GET');
  
    const response = await axios.get(`${BASE_URL}/v1.0/users/${process.env.UID}/devices`, {
      headers: {
        client_id: ACCESS_ID,
        access_token: accessToken,
        sign: sign,
        t: timestamp,
        sign_method: "HMAC-SHA256",
      },
    });
  
    if (response.data.success) {
      const devices = response.data.result;
      // devices.forEach((device) => {
      //   console.log(`Device Name: ${device.name}, Device ID: ${device.id}`);
      // });
      return devices
    } else {
      throw new Error(`Failed to fetch devices: ${response.data.msg}`);
    }
  }
  
  

  // Change password button on login page, send code, when verified, choose new password

  // Mailer
  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: process.env.MAILER_USER,
      pass: process.env.MAILER_PASS,
    },
  });


  // Maitenance
  const job = cron.schedule('0 0 * * *', maintainUsers);
  //const job = cron.schedule('*/30 * * * * *', maintainUsers);
  job.start()
  
let latest;
const bypass_confirmations = false
  
const urlToPing = process.env.PING_URL;
 
const pingUrl = () => {
  axios.get(urlToPing)
    .then((res) => {
      latest = res.data
      
    })
    .catch((error) => {
      setTimeout(pingUrl, 2000); // Retry after 2 seconds
    });
};

cron.schedule('*/10 * * * *', pingUrl);
pingUrl();

// Refresh the access token for SmartThings
async function getAccessToken() {

  try {
    const response = await axios.post(
      'https://api.smartthings.com/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: settings.refreshToken || "e69ec24e-5913-44af-94b9-7c567538d0c9",
      }),
      {
        auth: {
          username: clientId,
          password: clientSecret,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );



    updateSetting('accessToken', response.data.access_token);
    updateSetting('refreshToken', response.data.refresh_token);

    // console.log('Access Token:', response.data.access_token);
    return response.data.access_token;
  } catch (error) {
    console.error('Error fetching token:', error.response ? error.response.data : error.message);
  }
}


  async function maintainUsers()
  {

    // Email me a confirmation that the server is running
    const mailOptions = {
      from: process.env.MAILER_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `Successful SmartHome Maitenance`,
      text: `Hi Peter, just a confirmation that maitenance has ran for the SmartHome`,
    };
  
    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log('Error sending warning email:', error);
      } else {
      }
    });

    // Refresh the access token
    await getAccessToken();
    

  }





  // Endpoints


  router.get('/', (req,res) => {
      res.send(process.env.APP_NAME)
  })


  async function isSubscribed(user_id) {
    const maxRetries = 3; // Maximum number of retry attempts
    let retries = 0;
  
    while (retries < maxRetries) {
      try {
        const options = {
          method: 'GET',
          url: `https://api.revenuecat.com/v1/subscribers/${user_id}`,
          headers: { accept: 'application/json', Authorization: `Bearer ${REVENUECAT_API_KEY}` },
        };
  
        const response = await axios.request(options);
  
        // The user
        const subscriber = response.data.subscriber;
        const entitlements = subscriber.entitlements;
  
        // Look at the user's entitlements to check for cards
        for (const value of Object.values(entitlements)) {
          if (value['product_identifier'] === 'cards') {
            // Check if it is active
            const expirationTime = new Date(value.expires_date);
            const currentTime = new Date();
            return expirationTime > currentTime;
          }
        }
  
        // If no relevant entitlement was found, assume not subscribed
        return false;
      } catch (error) {
        if (error.response && error.response.status === 429) {
          const retryAfterHeader = error.response.headers['Retry-After'];
          if (retryAfterHeader) {
            const retryAfterMs = parseInt(retryAfterHeader)
            console.log(`Too Many Requests. Retrying after ${retryAfterMs} milliseconds...`);
            await wait(retryAfterMs);
          } else {
            console.log('Too Many Requests. No Retry-After header found.');
          }
          retries++;
        } else {
          // Handle other types of errors or non-retryable errors
          console.error('Error fetching isSubscribed: ', error.response.status);
          return false;
        }
      }
    }
  
    throw new Error(`Request to get isSubscribed failed after ${maxRetries} retries`);
  }
  
  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }



  // Ensure alive
  router.get('/ping', async(req, res) => {
    res.json(Date.now())
  })

  

  // Load the user when they log in
  // Can we move this to the return of /login? this is unclear!
  // the reason we don't, is because we only need to /login once which gets the id (and will also return the user object), 
  // and /user is used once we have the id to get the user object from id (where /login gets it from email / pass)

  router.post('/user', (req, response) => {
    // Define fields to exclude from the user object (for security)
    const excludedFields = ['password'];

    // Utility function to remove specified fields from user obj
    const excludeFields = (obj) => {
      const newObj = { ...obj };
      excludedFields.forEach(field => delete newObj[field]);
      return newObj;
    };

    // Get the user
    User.findByIdAndUpdate(
      req.body.user_id,
      {
        // Do we need this AND /appOpened?
        // added appOpened because ... we may store the user on the device, no need to retrieve from db (faster)
        // faster if we have cached data. But, we we only try to login if cached anyway.
        // because , we hit this endpoint when logging in, which will occur when the app mounts for the first time
        // so, ...
        $set: { dormant: 0 } // Set dormant days to 0: Handled now by /appOpened endpoint

      }, {new: true}).then(async (user) => {
        

        if (user)
        {

          response.status(200).send({
            user: excludeFields(user.toObject()),
          });
        }
        else
        {
          response.status(404).send({
            message: "User not found!",
          });
        }
      })
      .catch((e) => {
        
        response.status(500).send({
          message: "Error finding user",
        });
      })
      
      
  })

  // Change the password
  router.post('/setNewPassword', async(req,res) => {
    let code = req.body.resetCode
    let pass = req.body.pass
    let email = req.body.email

    // Find the user 
    let user = await User.findOne({email: email})


        // Validate request
        if (user && user.code == code) {
          // user is authorized to change the password
          // hash the password
          bcrypt
          .hash(pass, 5)
          .then((hashedPassword) => {
            // create a new user instance and collect the data
            user.password = hashedPassword

            // save the user
            user.save()
              // return success if the new user is added to the database successfully
              .then((updatedUser) => {
                res.status(200).send({
                  message: "Password changed successfully",
                  token: user._id,
                });
              })
              // catch error if the new user wasn't added successfully to the database
              .catch((errorResponse) => {

                  res.status(500).send({
                    message: "Error changing password!",
                    errorResponse,
                  });
                
              });
          })
          // catch error if the password hash isn't successful
          .catch((e) => {
            res.status(500).send({
              message: "Password was not hashed successfully",
              e,
            });
          });

        }

        else{
          //unauthorized request
          res.status(401)
          res.json('Unauthorized')
        }


    
  })

  // Send reset code to email
  router.post('/resetPassword', (req, res) => {
    const randomDecimal = Math.random();
      const code = Math.floor(randomDecimal * 90000) + 10000;

      const updateOperation = {
          $set: {
            code: code
          },
        };
        
        // Use findOneAndUpdate to update the user's properties
        User.findOneAndUpdate(
          { email: req.body.email }, // Find the user by email
          updateOperation).then(() => {

            const mailOptions = {
              from: process.env.MAILER_USER,
              to: req.body.email,
              subject: `${code} is your ${process.env.APP_NAME} confirmaition code`,
              text: `A new password was requested for your account. If this was you, enter code ${code} in the app. If not, somebody tried to log in using your email.`,
            };
          
            // Send the email
            transporter.sendMail(mailOptions, (error, info) => {
              if (error) {
                console.log('Error sending email:', error);
                res.status(500)
                res.json({error: "error sending email"})
              } else {
                console.log('successfully sent code')
                res.status(200)
                res.json('successfully sent password reset email')
                
              }
            });
          }) 

  })

  // Function to send a verification code
  // New device is recognized during login. User account exists.
  // Must take user id and email, and device_id
  // store device_id in pending_device in user db
  // generate and store a device_code in user db
  // send email with the code and message
  async function sendCode(user, device) {

    return new Promise((resolve, reject) => {
      // Generate code
      const randomDecimal = Math.random();
      const code = Math.floor(randomDecimal * 90000) + 10000;

      const updateOperation = {
          $set: {
            code: code,
            pending_device: device,
            code_attempts: 0, // Reset failure count
          },
        };
        
        // Use findOneAndUpdate to update the user's properties
        User.findOneAndUpdate(
          { _id: user._id }, // Find the user by object ID
          updateOperation, // Apply the update operation
          { new: true }).then(() => {

            const mailOptions = {
              from: process.env.MAILER_USER,
              to: user.email,
              subject: `${code} is your ${process.env.APP_NAME} confirmaition code`,
              text: `Your ${process.env.APP_NAME} account was accessed from a new location. If this was you, enter code ${code} in the app. If not, you can change your password in the app. Feel free to reply to this email for any assistance!`,
            };
          
            // Send the email
            transporter.sendMail(mailOptions, (error, info) => {
              if (error) {
                console.log('Error sending email:', error);
                reject('Could not send mail!')
              } else {
                console.log('successfully sent code')
                resolve('Sent code!')
                
              }
            });
          }) 
        
    }) // Promise end
    }

  // Check the code the user provided
  router.post("/confirmDevice", async (req, response) => {
    // fetch the pending code and device id 
    let user = await User.findOne({email: req.body.email})

    //let user = null
        if (user) {
            
            // Check if the codes match, if so add the device
            if (user.code == req.body.code)
            {
              response.status(200).send({
                message: "Success!",
                token: user._id
              });
                
                  

            }
            else{

              // If this is their third failed code
              if (user.code_attempts >= 2)
              {
                // Return exhausted status
                response.status(429).send({
                  message: "Too many requests!",
                  });

                return
              }

              // First or second failure: Increase count and send wrong code 401
              User.findByIdAndUpdate( user._id, { $inc: { code_attempts: 1 } },
                { new: true }).then((updatedUser) => {

                  if (updatedUser) {
                    


                  } else {
                    console.log('Failed updating user document api/confirmDevice')
                    response.status(404).send({
                        message: "Could not locate user",
        
                    });
                  }

                })

                // Moved to here instead of if statement so the UI response does not wait on a DB operation
                response.status(401).send({
                  message: "Wrong code!",
                  });
              
            }
    
        //console.log('Code:', user.code);
        //console.log('Pending Device:', user.pending_device);
        } else {
            response.status(404).send({
                message: "Could not find user",
              });
        }
})

  // Send help email
  router.post("/contact", (request, response) => {
    const mailOptions = {
      from: process.env.MAILER_USER,
      to: process.env.MAILER_USER,
      bcc: process.env.ADMIN_EMAIL,
      subject: `${process.env.APP_NAME} Support`,
      text: `${request.body.msg}\n\nfrom ${request.body.email} (${request.body.uid})`,
    };
  
    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log('Error sending support email from user:', error);
        response.status(500).send("Error")
      } else {
        response.status(200).send("Success")

      }
    });
  })

  // register endpoint
  // makes an account
  router.post("/register", (request, response) => {
    // hash the password
    bcrypt
      .hash(request.body.password, 5)
      .then((hashedPassword) => {
        // create a new user instance and collect the data

        const user = new User({
          email: request.body.email,
          password: hashedPassword,
          filters: {
            sports: userSports // Initialize filters.sports with sports data
          }
        });
  
        // save the new user
        user.save()
          // return success if the new user is added to the database successfully
          .then((result) => {
            // Email me of the new user, if option is enabled
            Options.findOne({}).then((option_doc) => {
              if (option_doc.registerAlerts)
              {
                // Send the email
                const mailOptions = {
                  from: process.env.MAILER_USER,
                  to: process.env.MAILER_USER,
                  bcc: process.env.ADMIN_EMAIL,
                  subject: `${process.env.APP_NAME} new user! 😁`,
                  text: `${request.body.email} has signed up!`,
                };
              
                // Send the email
                transporter.sendMail(mailOptions, (error, info) => {
                  if (error) {
                    console.log('Error sending new user email (to myself):', error);
                  } else {
                  }
                });
                
              }

            })

            response.status(201).send({
              message: "User Created Successfully",
              result,
            });
          })
          // catch error if the new user wasn't added successfully to the database
          .catch((errorResponse) => {
            let errorMessage = null;

            for (const key in errorResponse['errors']) {
              if (errorResponse['errors'][key].properties && errorResponse['errors'][key].properties.message) {
                errorMessage = errorResponse['errors'][key].properties.message;
                break; // Stop iterating once found
              }
            }

            if (errorMessage)
            {
              console.log(errorMessage)
              response.status(403).send({
                message: errorMessage,
                errorResponse,
              });
            }
            else{
              response.status(500).send({
                message: "User already exists!",
                errorResponse,
              });
            }
            
            
          });
      })
      // catch error if the password hash isn't successful
      .catch((e) => {
        response.status(500).send({
          message: "Password was not hashed successfully",
          e,
        });
      });
  });

/**
 * Verifies a user's identity by checking their password.
 * @param {string} uid - The user ID.
 * @param {string} password - The password to check.
 * @returns {Promise<Object>} - Resolves with the user object if successful, or rejects with an error message.
 */
function verifyUser(uid, password) {
  return User.findById(uid)
    .then((user) => {
      if (!user) {
        return Promise.reject({ status: 404, message: "User not found" });
      }

      return bcrypt.compare(password, user.password).then((passwordCheck) => {
        if (!passwordCheck) {
          return Promise.reject({ status: 401, message: "Wrong password" });
        }

        return user; // Return the user if password is correct
      });
    })
    .catch((error) => {
      // Handle unexpected errors
      if (!error.status) {
        console.error("Error during user verification:", error);
        error = { status: 500, message: "Internal server error" };
      }
      throw error;
    });
}

router.post('/update-account', (req, res) => {
  const { uid, password, newpass, newcompanyname } = req.body;

  verifyUser(uid, password)
    .then((user) => {

      // Cancel if nothing will change
      if (!newpass && newcompanyname === user.company) {
        return res.status(400).send({ message: "No changes provided" });
      }

      // Prepare the fields to update
      const updateFields = {};
      if (newcompanyname) updateFields.company = newcompanyname;

      // Hash the new password if provided
      if (newpass) {
        return bcrypt
          .hash(newpass, 10)
          .then((hashedPassword) => {
            updateFields.password = hashedPassword;
            return User.findOneAndUpdate({ _id: uid }, updateFields, { new: true });
          });
      }

      // If only company is updated
      return User.findOneAndUpdate({ _id: uid }, updateFields, { new: true });
    })
    .then((updatedUser) => {
      if (!updatedUser) {
        return res.status(400).send({ message: "Bad request" });
      }

      res.json({ id: updatedUser._id });
    })
    .catch((error) => {
      console.error(error); // Log the error for debugging
      const status = error.status || 500;
      const message = error.message || "Internal server error";
      res.status(status).send({ message });
    });
});

  

// login / register merged endpoint

router.post("/log-or-reg", (request, response) => {
    // check if email exists
    updateSettings()
    
    User.findOne({ email: request.body.email })
    
      // if email exists
      .then((user) => {
        
        // compare the password entered and the hashed password found
        bcrypt
          .compare(request.body.password, user.password)

          // if the passwords match
          .then(async (passwordCheck) => {

            
  
            // check if password matches
            if(!passwordCheck) {
                return response.status(400).send({
                message: "Passwords does not match",
              });
            }

            console.log('Logging in..')

            // Force 2FA for each login
            {
                // Device not recognized. Send email code to recognize device!
                // When code is entered, allow the login and add the device to DB.

                sendCode(user, request.body.device).then((res) =>
                {
                  console.log("code sent!")
                    // Code was sent successfully 
                    response.status(422).send({
                        message: res
                    });

                })
                .catch((error) => {
                  console.log(error)
                  response.status(500).send({
                    message: error,
                });
                })
                
            }

            
  
            
          })
          // catch error if password does not match
          .catch((error) => {
            console.log(error)
            response.status(400).send({
              message: "Passwords do not match",
              error,
            });
          });
      })
      // catch error if email does not exist
      .catch((e) => {

        // Make sure we're on the whitelist. If not, return with error. The whilelist is found in settings.users_whitelist

        // settings.users_whitelist is a csv string. Convert it to an array so we can use .includes on it
        const whitelist = settings.users_whitelist.split(',').map(item => item.trim());


        if (!whitelist.includes(request.body.email))
        {
          response.status(401).send({
            message: "Unauthorized",
            e,
          });
          return
        }
        
        
        // @REGISTER : EMAIL NOT FOUND
        // hash the password
        bcrypt
        .hash(request.body.password, 5)
        .then((hashedPassword) => {
          // create a new user instance and collect the data
          const user = new User({
            email: request.body.email,
            password: hashedPassword,
            email_confirmed: bypass_confirmations
          });
    
          // save the new user
          user.save()
            // return success if the new user is added to the database successfully
            .then((result) => {
              


              if (bypass_confirmations)
              {
                response.status(200).send({
                  message: "Registration Successful",
                  token: user._id,
                  new_account: true,
                  new_user: false
                });
              }
              else
              {
                // Now, send the code to verify the email
                sendCode(user, request.body.device)
                .then((res) =>
                  {
                    console.log("code sent!")
                      // Code was sent successfully 
                      response.status(422).send({
                          message: res
                      });
    
                  })
                  .catch((error) => {
                    console.log(error)
                    response.status(500).send({
                      message: error,
                    });
                  })
              }

            })
            // catch error if the new user wasn't added successfully to the database
            .catch((errorResponse) => {
              
                response.status(500).send({
                  message: "Internal error!",
                  errorResponse,
                });
              
              
            });
        })
        // catch error if the password hash isn't successful
        .catch((e) => {
          response.status(500).send({
            message: "Password was not hashed successfully",
            e,
          });
        });

      });
  });

  //login
router.post("/login", (request, response) => {
// check if email exists

User.findOne({ email: request.body.email })

  // if email exists
  .then((user) => {
    
    
    // compare the password entered and the hashed password found
    bcrypt
      .compare(request.body.password, user.password)

      // if the passwords match
      .then(async (passwordCheck) => {

        

        // check if password matches
        if(!passwordCheck) {
            return response.status(400).send({
            message: "Passwords does not match",
          });
        }

        console.log('Logging in..')

        //Now check if device is permitted
        if (user.devices.includes(request.body.device) || user.email == "demo@demo.demo")
        {

            response.status(200).send({
                message: "Login Successful",
                token: user._id,
                new_account: !user.account_complete,
                new_user: false
            });
        }
        else 
        {
            // Device not recognized. Send email code to recognize device!
            // When code is entered, allow the login and add the device to DB.

            sendCode(user, request.body.device)
            .then((res) =>
            {
              console.log("code sent!")
                // Code was sent successfully 
                response.status(422).send({
                    message: res
                });

            })
            .catch((error) => {
              console.log(error)
              response.status(500).send({
                message: error,
            });
            })
            
        }

        

        
      })
      // catch error if password does not match
      .catch((error) => {
        console.log(error)
        response.status(400).send({
          message: "Passwords do not match",
          error,
        });
      });
  })
  // catch error if email does not exist
  .catch((e) => {
    
    response.status(404).send({
      message: "Email not found",
      e,
    });
  });
});

 

  // Delete account
  router.post('/deleteAccount', async(req, response) => {
    let pwd = req.body.password
    let id = req.body.id

    User.findById({_id: id })
      
        // if email exists
        .then((user) => {
          
          
          // compare the password entered and the hashed password found
          bcrypt
            .compare(pwd, user.password)

            // if the passwords match
            .then(async (passwordCheck) => {
    
              // check if password matches
              if(!passwordCheck) {
                  return response.status(400).send({
                  message: "Passwords does not match",
                });
              }

              User.findByIdAndDelete(id)
              .then((res)=> {
                response.status(200).send({
                  message: "Delete Successful"
              });

              })
              .catch((e) => {
                response.status(500).send({
                  message: e
              });

              })

                  
              
            })
            // catch error if password does not match
            .catch((error) => {
              console.log(error)
              response.status(400).send({
                message: "Passwords does not match",
                error,
              });
            });
        })
        // catch error if email does not exist
        .catch((e) => {
          
          response.status(404).send({
            message: "User not found",
            e,
          });
        });
  })


  module.exports = router;