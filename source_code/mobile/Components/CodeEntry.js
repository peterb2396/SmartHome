
import React from 'react';
import { View, Text, Platform, TouchableOpacity, StyleSheet } from 'react-native';
import CodeInput from 'react-native-confirmation-code-input';
import config from "../app.json"

const CodeEntry = ({ fulfilled, status, back }) => {

  // Return to login
  function handlePress()
  {
    // back button
    back()
  }

    return (

      <View style={styles.containerView} behavior="padding">
       
        
        <View style={styles.loginScreenContainer}>

          {/* Back Button */}
          <TouchableOpacity style = {{margin: Platform.OS === 'ios' && Platform.isPad ? 50 : 25, padding: 15}} onPress={handlePress}>
            <Text style={styles.button} >{'<'}</Text>
          </TouchableOpacity>
                


            
          <View style={styles.loginFormView}>
            
            <Text style={styles.logoText}>{config.expo.name}</Text>
            <Text style={styles.errorText}>{status}</Text>  

            <CodeInput
              secureTextEntry = {false}
              activeColor='rgba(67, 121, 209, 1)'
              inactiveColor='rgba(67, 121, 209, 1.3)'
              autoFocus={true}
              ignoreCase={true}
              keyboardType= {Platform.OS === 'ios' ? 'numeric' : 'number-pad'}
              inputPosition='center'
              size={50}
              onFulfill={fulfilled}
              //containerStyle={{ marginTop: 30 }}
              codeInputStyle={{ borderWidth: 1.5 }}
            />  
          


          </View>
        </View>
    </View>

      
    );

    
  }

  const styles = StyleSheet.create({
    containerView: {
      flex: 1,
      alignItems: "center"
    },
    loginScreenContainer: {
      flex: 1,
      width: "100%",
      top: -100
    },
    logoText: {
      fontSize: Platform.OS === 'ios' && Platform.isPad ? 65 : 40,
      fontWeight: "100",
      marginTop: 150,
      marginBottom: 30,
      textAlign: "center",
    },
    errorText: {
      fontSize: Platform.OS === 'ios' && Platform.isPad ? 25 : 18,
      fontWeight: "200",
      marginTop: 20,
      marginBottom: 30,
      marginHorizontal: 40,
      textAlign: "center",
    },
    loginFormView: {
      flex: 1,
    },
    loginFormTextInput: {
      height: Platform.OS === 'ios' && Platform.isPad ? 76: 43,
      fontSize: Platform.OS === 'ios' && Platform.isPad ? 24 : 14,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: "#eaeaea",
      backgroundColor: "#fafafa",
      paddingLeft: 10,
      marginTop: 5,
      marginBottom: 5,
    },
    loginButton: {
      backgroundColor: "#3897f1",
      borderRadius: 5,
      height: Platform.OS === 'ios' && Platform.isPad ? 65 : 45,
      marginTop: 10,
      width: 350,
      alignItems: "center"
    },
    container: {
      marginTop: 50,
      marginBottom:-50,
    },
    button: {
      fontSize: Platform.OS === 'ios' && Platform.isPad ? 38 : 24,
    },
  });


export default CodeEntry;
