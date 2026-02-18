const mongoose = require("mongoose");
require('dotenv').config()


async function dbConnect() {
  mongoose.connect( process.env.MONGO_URI, {dbName: process.env.APP_NAME.replace(" ", "")})
    .then(() => {
      
      console.log("Successfully connected to MongoDB Atlas!");
    })
    .catch((error) => {
      console.log("Unable to connect to MongoDB Atlas!");
      console.error(error);
    });
}


module.exports = dbConnect;