// Import the Express.js framework
const express = require('express');
require('dotenv').config();
var cors = require('cors');
var bodyParser = require('body-parser')
var cookieParser = require('cookie-parser');


// Create an instance of the Express application
var api = require('./api');
var app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Make middleware to print post details
// app.use((req, res, next) => {
//   console.log(`User accessed: ${req.method} ${req.originalUrl}`);
//   if (req.method === 'POST') {
//     console.log('Body:', req.body); // Log the body for POST requests
//   }
//   next(); // Passes control to the next middleware or route handler
// });

app.use(express.json());
app.use (express.urlencoded({extended: true}));
app.use(cookieParser());

app.use('/', api);



// Start the server on port 3000
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Home Server is running on port ${PORT}`);
});