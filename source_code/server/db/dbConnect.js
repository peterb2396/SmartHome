const mongoose = require("mongoose");
require('dotenv').config()

const Trial = require("./trialModel");
const Options = require("./optionsModel");

async function dbConnect() {
  mongoose.connect( process.env.MONGO_URI, {dbName: process.env.APP_NAME.replace(" ", "")})
    .then(() => {
      
      console.log("Successfully connected to MongoDB Atlas!");
      initDb()
    })
    .catch((error) => {
      console.log("Unable to connect to MongoDB Atlas!");
      console.error(error);
    });
}

async function initDb ()
   {
    // Make default Options doc
  try {
    // Check if any Options document exists
    const optionsCount = await Options.countDocuments();

    if (optionsCount === 0) {
      // No documents found, create a default one
      const defaultOptions = new Options({});
      await defaultOptions.save();
      console.log("Default options document created.");
    } else {
      
    }
  } catch (error) {
    console.error("Error creating default options document:", error);
  }

  // Make default trial doc (keeps track of new users)
  try {
    // Check if any Options document exists
    const trialCount = await Trial.countDocuments();

    if (trialCount === 0) {
      // No documents found, create a default one
      const defaultTrials= new Trial({});
      await defaultTrials.save();
      console.log("Default trial document created.");
    } else {
      
    }
  } catch (error) {
    console.error("Error creating default trial document:", error);
  }
  }
  

module.exports = dbConnect;