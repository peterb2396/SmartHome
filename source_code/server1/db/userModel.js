const mongoose = require("mongoose");
const uniqueValidator = require('mongoose-unique-validator');

const UserSchema = new mongoose.Schema({

email: {
    type: String,
    required: [true, "Please provide an email."],
    unique: [true, "Username taken!"],
    maxlength: [100, "Email too long"],
    uniqueCaseInsensitive: true
},

password: {
    type: String,
    required: [true, "Please provide a password!"],
    unique: false,
},

pending_device: {
    type: String
},

code: {
    type: Number
},

code_attempts: {
    type: Number,
    default: 0
},


devices: {
    type: Array
},
}, {strict: false});

UserSchema.plugin(uniqueValidator, {
    message: 'Error, expected {PATH} to be unique.'
  });
  
module.exports = mongoose.model.Users || mongoose.model("User", UserSchema);