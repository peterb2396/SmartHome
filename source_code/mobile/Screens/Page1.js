import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity
} from 'react-native';
import config from "../app.json"

// Render a list of all meals saved in the database
const Page1 = ({prop1, prop2 }) => {

  function doStuff()
  {
    console.log("Doing stuff!")
  }

  return (
    <View>
      <Text>{`Page 1 (${config.expo.name})`}</Text>
      <TouchableOpacity
        style={
          {
            borderWidth: 1,
            borderColor: 'red',
            borderRadius: 5,
            padding: 10,
          }
        }
        onPress={doStuff}
      >
        <Text>Do Stuff</Text>
      </TouchableOpacity>
    </View>
  );
};

export default Page1;
