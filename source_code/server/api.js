  var express = require('express');
  const dbConnect = require("./db/dbConnect");
  const User = require("./db/userModel");
  const Trial = require("./db/trialModel");
  const Options = require("./db/optionsModel");
  const cron = require('node-cron');
  var router = express.Router();
  require('dotenv').config();
  var axios = require('axios')
  const bcrypt = require("bcrypt");
  const nodemailer = require('nodemailer');
  const crypto = require("crypto");
  const qs = require('qs'); // Import qs for URL encoding

  

  // DB connection
  //dbConnect()

  const clientId = process.env.SMART_CLIENT_ID;
  const clientSecret = process.env.SMART_CLIENT_SECRET;

  // Store token info (access and expiration)
  let accessToken2 = '';
  let tokenExpiration = 0;

  
  const ACCESS_ID = process.env.ACCESS_ID
  const ACCESS_SECRET = process.env.ACCESS_SECRET
  const BASE_URL = "https://openapi.tuyaus.com";
  
  let accessToken = null;
  let tokenExpiry = null;


  // Function to turn on all lights

  // Function to get a new access token
// Function to get a new access token
async function getAccessToken() {
  try {
    const data = qs.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    const response = await axios.post('https://api.smartthings.com/oauth/token', data, { headers });

    accessToken2 = response.data.access_token;
    tokenExpiration = Date.now() + response.data.expires_in * 1000;

    console.log('Access Token:', accessToken2);
    return accessToken2;
  } catch (error) {
    console.error('Error getting access token:', error);
  }
}


// Ensure valid access token
async function ensureValidToken() {
  if (!accessToken2 || Date.now() >= tokenExpiration) {
    console.log('Token expired or not available. Getting a new one...');
    await getAccessToken();
  }
}

// List devices
async function listDevices() {
  await ensureValidToken();
  
  try {
    const response = await axios.get('https://api.smartthings.com/v1/devices', {
      headers: {
        Authorization: `Bearer ${accessToken2}`,
      },
    });
    return response.data.items;
  } catch (error) {
    console.error('Error listing devices:', error.code);
    throw new Error('Failed to list devices');
  }
}

// Turn off all lights
async function lights(lightDevices = null, on = true) {
  await ensureValidToken();

  try {
    const devices = lightDevices || await listDevices();
    const lights = devices.filter(device => device.capabilities.some(cap => cap.id === 'switch'));

    for (const light of lights) {
      const deviceId = light.deviceId;

      await axios.post(
        `https://api.smartthings.com/v1/devices/${deviceId}/commands`,
        {
          commands: [
            {
              capability: 'switch',
              command: on ? 'on' : 'off',
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
    console.error('Error turning off lights:', error);
    throw new Error('Failed to turn off lights');
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
        { code: "switch_1", value: isOn }
      ]
    });

    const result = await controlDevice(password, device, body);
    return result;
  }
  
  // General device control: Pass the body
  async function controlDevice(password, device, body) {



    if (password !== process.env.PASSWORD) return null

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

  // User left the house
  router.post("/leave", ensureAccessToken, async (req, res) => {
    
    try {
      // Turn on Milo's camera

      const result = await powerPlug(req.body.password, 1, true);
      if (!result)
      {
        res.status(401).send("UNAUTHORIZED")
        console.log("Unauthorized request receieved")
        return
      }

      console.log(req.body.who? req.body.who : "Anonymous","left the house", req.body.deviceId)

      // Turn off all the lights

      



        
      // res.json({ success: true, data: result });
    } catch (error) {
      console.error("Error powering device:", error);
      res.status(500).json({ error: "Failed to power device" });
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


  // Daily Maitenance
  // * Send warning emails
  // * Delete inactive accounts (if they arent subscribed!)

  // Maitenance
  //const job = cron.schedule('0 0 * * *', maintainUsers);
  //const job = cron.schedule('*/30 * * * * *', maintainUsers);
  //job.start()
  
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


  async function maintainUsers()
  {
    const currentDate = new Date();

    // Email me a confirmation that the server is running
    const mailOptions = {
      from: process.env.MAILER_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `Successful Template Maitenance`,
      text: `Hi Peter, just a confirmation that maitenance has ran for all Template users successfully.`,
    };
  
    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log('Error sending warning email:', error);
      } else {
      }
    });

    // Calculate the date 10 days from now
    const futureDate = new Date(currentDate);
    futureDate.setDate(currentDate.getDate() + 10);

    // Format the date as "Month Day, Year"
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = futureDate.toLocaleDateString('en-US', options);


    try {

      // SUBSCRIPTIONS

      // Find all users that renew today and check/update entitlements
      let users = await User.find({renewal_date: currentDate.getDate()})
        
      // Iterate through each user and update tokens if they have an active entitlement
      for (const user of users) {
        let subscribed = await isSubscribed(user._id)
        if (subscribed)
        {
          await User.updateOne({ _id: user._id }, { $set: { tokens: process.env.TOKEN_COUNT } });
        }
        else
        {
          // It looks like they expired today. Remove tokens.
          // Update: They did pay for month long access.. so dont remove the tokens. 
          await User.updateOne({ _id: user._id }, { $set: { renewal_date: 0 } });
          // Be sure to stop renewing them.
        }
        
      }


    
      // Increment 'dormant' field by 1 for all users
      await User.updateMany({}, { $inc: { dormant: 1 } });

      // Find and remove users with 'marked_for_deletion' and 'email_confirmed' both set to false
      await User.deleteMany({ marked_for_deletion: true });

      // Email a warning to all inactive users
      const dormantUsers = await User.find({
        $and: [
          { dormant: { $gte: 365 } }
        ]
      });

      // Send each email to dormant users who are not subscribed
      dormantUsers.forEach((user) => {
        
        // Dont delete paying users
        if (!isSubscribed(user._id))
        {
          const mailOptions = {
            from: process.env.MAILER_USER,
            to: user.email,
            subject: `${process.env.APP_NAME} account scheduled for deletion`,
            text: `Your ${process.env.APP_NAME} account hasn't been accessed in ${user.dormant} days, 
            and data is scheduled to be purged from our system on ${formattedDate}. 
            To keep your data, simply log in to your account. We hope to see you soon!`,
          };
        
          // Send the email
          transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
              console.log('Error sending warning email:', error);
            } else {
            }
          });
  

        }
        
      });


      // MARK UNCONFIRMED USERS FOR DELETION
      try {
        // Find users where 'email_confirmed' is false
        const unconfirmedUsers = await User.find({ email_confirmed: false });
    
        // For all unconfirmed users prepare to mark for deletion
        // If they are not subscribed
        const updatePromises = unconfirmedUsers
        .filter(user => !isSubscribed(user._id))
        .map((user) => {
          user.marked_for_deletion = true;
          return user.save();
        });

    
        // Execute all the update operations
        await Promise.all(updatePromises);
    
      } catch (error) {
        console.error('Error marking users for deletion:', error);
      }


    } catch (error) {
      console.error('Error updating users:', error);
    }
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
              // Before adding this device, check if we can activate trial tokens
              Trial.findOne({}).then((trial_doc) => {

                const emailExists = trial_doc.emails.includes(user.email);
                const deviceExists = trial_doc.devices.includes(user.pending_device);
                let new_user = true

                if (emailExists)
                {
                  new_user = false
                }
                else
                {
                  trial_doc.emails.push(user.email)
                }

                if (deviceExists)
                {
                  new_user = false
                }
                else
                {
                  trial_doc.devices.push(user.pending_device)
                }

                

                trial_doc.save()


                // Confirm email / grant trial if applicable
                User.findByIdAndUpdate(
                  user._id,
                  {
                    // Grant trial if applicable
                    // $inc: { tokens: new_user? process.env.TRIAL_TOKENS: 0 },
                    $set: { email_confirmed: true }, // Confirmed the email
                    $push: { devices: user.pending_device}
                  },
                  { new: true }).then((updatedUser) => {

                    if (updatedUser) {
                      response.status(200).send({
                        message: "Success!",
                        new_user: new_user,
                        new_account: !user.account_complete,
                        token: user._id
                      });


                    } else {
                      response.status(404).send({
                          message: "Could not locate user",
                      });
                    }

                  })
              })

                
                  

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
            if (bypass_confirmations || user.devices.includes(request.body.device) || user.email == "demo@demo.demo")
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