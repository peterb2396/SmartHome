import React, {useState, useEffect } from "react";

import axios from "axios";
import CodeEntry from "./CodeEntry";

import config from '../app.json';

import {
  Keyboard,
  KeyboardAvoidingView,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  StyleSheet,
  Platform,
} from "react-native";
import { Button} from "react-native-elements";

let Constants;
let deviceInfoModule;

if (__DEV__) {
  // Check if running in Expo
  try {
    Constants = require('expo-constants');
    deviceInfoModule = Constants;
  } catch (error) {
    // If not in Expo, require react-native-device-info
    deviceInfoModule = require('react-native-device-info');
  }
} else {
  // In production, use Expo's Constants if available
  if (typeof Constants !== 'undefined') {
    deviceInfoModule = Constants;
  } else {
    // Otherwise, require react-native-device-info
    deviceInfoModule = require('react-native-device-info');
  }
}

export default function LoginScreen(props) {

  const isEmail = /^[\w-]+(\.[\w-]+)*@[\w-]+(\.[\w-]+)+$/;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showCode, setShowCode] = useState(false)
  const [loginInProgress, setLoginInProgress] = useState(false)


  const [forgotPassword, setForgotPassword] = useState(false)
  const [canResetPass, setCanResetPass] = useState(false)
  const [resetCode, setResetCode] = useState()
  const [emailv1, setEmailv1] = useState('');
  const [emailv2, setEmailv2] = useState('');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');

  const [status, setStatus] = useState('')
 
  
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    const getDeviceId = async () => {
      let id;

      if (deviceInfoModule) {
        if (deviceInfoModule === Constants) {
          // Running in Expo
          
          id = deviceInfoModule["default"]["manifest2"]["id"];
        } else {
          // Not running in Expo
          id = await deviceInfoModule.getUniqueId();
        }
      } else {
        id = 'Device ID not available';
      }

      setDeviceId(id);
    };

    getDeviceId();
  }, []);

  // Handle forgot password button press to render new state
  const toggleForgotPassword = () => {
    setForgotPassword(!forgotPassword)
    if (forgotPassword)
    {
      setEmailv1(email)
    }
  }

  const onLogRegPress = () => {

    // disable the button
    setLoginInProgress(true)

    setStatus('Checking credentials...')

    axios.post(`${props.api}/log-or-reg`, {email: email, password: password, device: deviceId})
    .then((res) =>
    {
      // Credentials valid. And device is permitted
      // This section runs iff they do not need to confirm their device when logging in.
      // Instead the below code in the onFulfill function will run when confirming code.
      setStatus('Logging in...')
      props.login(res.data.token, res.data.new_user, res.data.new_account)
      // the above should also provide any metadata such as preferences, instead of the /user endpoint
    })
    .catch((e) => {
      setLoginInProgress(false)

      setStatus('Error, please try again')
      if (e.response.status === 400)
      {
        // Incorrect password
        setStatus('Incorrect password!')
      }
      else if (e.response.status === 422)
      {
        // New device, code sent
        setStatus('Please enter the code sent to your email.')

        // Load UI for code entry
        setShowCode(true)

      }

      // This should be impossible, because we just register if user was not found.
      else if (e.response.status === 404)
      {
        setStatus('User not found!')
      }
      else 
      {
        setStatus('Error, please try again')
      }
    })
    
  }

  const onLoginPress = () => {
    setStatus('Attempting login...')

    axios.post(`${props.api}/login`, {email: email, password: password, device: deviceId})
    .then((res) =>
    {
      // Credentials valid. And device is permitted
      // This section runs iff they do not need to confirm their device when logging in. Right now, this is NEVER!
      // Instead the below code in the onFulfill function will run when confirming code.
      setStatus('Logging in...')
      props.login(res.data.token, res.data.new_user, res.data.new_account)
      // the above should also provide any metadata such as preferences, instead of the /user endpoint
    })
    .catch((e) => {
      setStatus('Error, please try again')
      if (e.response.status === 400)
      {
        // Incorrect password
        setStatus('Incorrect password!')
      }
      else if (e.response.status === 422)
      {
        // New device, code sent
        setStatus('Please enter the code sent to your email.')

        // Load UI for code entry
        setShowCode(true)

      }
      else if (e.response.status === 404)
      {
        setStatus('User not found!')
      }
      else 
      {
        setStatus('Error, please try again')
      }
    })

  };

  // Register user
  const onRegisterPress = () => {
    axios.post(`${props.api}/register`, {email: email, password: password})
    .then((res) =>
    {
      //then, log in
      setStatus('Success!')
      onLoginPress()
    })
    .catch((e) => {
      console.log(e.response.data.errorResponse)
      setStatus(e.response.data.message)
      
    })

  };

  // User inputted verification code
  const onFulfill = (code) => {
    // check with server
    axios.post(`${props.api}/confirmDevice`, {email: email, code: code})
    .then(async (res) =>
    {
      // Code correct for forgot password
      if (forgotPassword)
      {
        // Logic here for setting new password: new return block: SECURITY! must pass code with change request, verify again
        setStatus('')

        // locally store the code that the user entered to send for more validation
        setResetCode(code)
        
        setCanResetPass(true) // Show UI for setting password
        setShowCode(false)
        setForgotPassword(false) // hide UI for forgot password
      }
      else 
      {
        // Login confirmation successful
        setStatus('Logging in...')
        // New user has never used the app before
        // New account is if we just made this account
        props.login(res.data.token, res.data.new_user, res.data.new_account)
        
        if (res.data.new_user)
        {
          alert(config.app.welcome_msg)
        }
      }
      
    })
    .catch((e) => {
      
      if (e.response.status === 401)
      {
        setStatus('Incorrect code, please try again.')
      }
      else 
      {
        if (e.response.status === 429)
        {
          setStatus('Too many failures. Please login again.')
        }
        else{
          setStatus('Error, please try again later')
        }

        // Code was not wrong, but there was an error. Return to login
        setShowCode(false)
        setForgotPassword(false)
        

      }
      
      

      // If code is exhasuted, return to login
    })
    
  };
  
  // Reset password
  const resetPassword = () => {
    // send code and new password as data
    axios.post(`${props.api}/setNewPassword`, {resetCode: resetCode, pass: pass1, email: email})
    .then((res) => {
      // force login with new password
      props.login(res.data.token, res.data.new_user, res.data.new_account)

    })
    .catch((e) => {
      console.log(e)
      setStatus('Error updating password')
    })
  }


  //send user code for a pass reset
  const sendResetPassCode = () => {
    // Send code to reset password
    setEmail(emailv1)
    axios.post(`${props.api}/resetPassword`, {email: emailv1})
    .then((res) =>
    {
      setStatus('Please enter the code sent to your email.')

    // Load UI for code entry
    setShowCode(true)

    })
    .catch((e) => {
      
      setStatus('Could not find user')
    })
    

  }

  if (showCode)
  {
    return(
      <CodeEntry back = {()=> {setShowCode(false); setStatus("")}} fulfilled = {onFulfill} status = {status} ></CodeEntry>
    )
  }

  if (canResetPass)
  {
    return (
      <KeyboardAvoidingView style={styles.containerView} behavior="padding">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.loginScreenContainer}>
            <View style={styles.loginFormView}>
              <Text style={styles.logoText}>Reset Password</Text>
              <TextInput
                placeholder="Enter new password"
                placeholderColor="#c4c3cb"
                secureTextEntry={true}
                style={styles.loginFormTextInput}
                onChangeText={(text) => {setPass1(text); setStatus((text === pass2)? '': 'Passwords must match')}}
              />
              <TextInput
                placeholder="Confirm new password"
                placeholderColor="#c4c3cb"
                secureTextEntry={true}
                style={styles.loginFormTextInput}
                onChangeText={(text) => {setPass2(text); setStatus((pass1 === text)? '': 'Passwords must match')}}
              />
              <Button
                buttonStyle={styles.loginButton}
                onPress={() => resetPassword()}
                title="Change Password"
                disabled={!((pass1 === pass2))}
              />
  
  
  
  
              <Text style={styles.errorText}>{status}</Text>
  
  
              <View style = {styles.bottomTextContainer}>
                <Text onPress = {() => setCanResetPass(false)}style={styles.bottomText}>Back to Login</Text>
              </View>
  
              
  
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    )
  }

  else if (forgotPassword)
  {
    return (
      <KeyboardAvoidingView style={styles.containerView} behavior="padding">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.loginScreenContainer}>
            <View style={styles.loginFormView}>
              <Text style={styles.logoText}>Reset Password</Text>
              <TextInput
                placeholder="Email"
                placeholderColor="#c4c3cb"
                style={styles.loginFormTextInput}
                onChangeText={(text) => {setEmailv1(text); setStatus((text === emailv2)? '': 'Please type the same email twice')}}
              />
              <TextInput
                placeholder="Confirm Email"
                placeholderColor="#c4c3cb"
                style={styles.loginFormTextInput}
                onChangeText={(text) => {setEmailv2(text); setStatus((emailv1 === text)? '': 'Please type the same email twice')}}
              />
              <Button
                buttonStyle={styles.loginButton}
                onPress={() => sendResetPassCode()}
                title="Send Reset Link"
                disabled={!(isEmail.test(emailv1) && isEmail.test(emailv2) && (emailv1 === emailv2))}
              />
  
  
  
  
              <Text style={styles.errorText}>{status}</Text>
  
  
              <View style = {styles.bottomTextContainer}>
                <Text onPress = {() => toggleForgotPassword()}style={styles.bottomText}>{(!forgotPassword? 'Forgot password': 'Login')}</Text>
              </View>
  
              
  
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    )
  }

  return (
    <KeyboardAvoidingView style={styles.containerView} behavior="padding">
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.loginScreenContainer}>
          <View style={styles.loginFormView}>
            <Text style={styles.logoText}>{config.expo.name}</Text>
            <TextInput
              placeholder="Email"
              placeholderColor="#c4c3cb"
              style={styles.loginFormTextInput}
              autoCapitalize="none"
              autoCorrect= {false}
              onChangeText={(text) => {setEmail(text); setStatus('')}}
            />
            <TextInput
              placeholder="Password"
              placeholderColor="#c4c3cb"
              autoCapitalize="none"
              autoCorrect= {false}
              style={styles.loginFormTextInput}
              secureTextEntry={true}
              onChangeText={(text) => {setPassword(text); setStatus('')}}
            />

            <Button
              buttonStyle={styles.loginButton}
              onPress={() => onLogRegPress()}
              title="Login / Sign-up"
              disabled={loginInProgress || !(isEmail.test(email) && password)}
            />

            {/* <Button
              buttonStyle={styles.loginButton}
              onPress={() => onLoginPress()}
              title="Login"
              disabled={!(isEmail.test(email) && password)}
            />

            <Button
              buttonStyle={styles.loginButton}
              onPress={() => onRegisterPress()}
              title="Register"
              disabled={!(isEmail.test(email) && password)}
            /> */}



            <Text style={styles.errorText}>{status}</Text>


            <View style = {styles.bottomTextContainer}>
              <Text onPress = {() => toggleForgotPassword()}style={styles.bottomText}>{(!forgotPassword? 'Forgot password': 'Login')}</Text>
            </View>

            

          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  containerView: {
    flex: 1,
    alignItems: "center"
  },
  loginScreenContainer: {
    flex: 1
  },
  logoText: {
    fontSize: Platform.OS === 'ios' && Platform.isPad ? 60 : 40,
    fontWeight: "100",
    marginTop: Platform.OS === 'ios' && Platform.isPad ? 250 : 150 ,
    marginBottom: 30,
    textAlign: "center",
  },
  errorText: {
    fontSize: Platform.OS === 'ios' && Platform.isPad ? 24 : 18 ,
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
    height: 43,
    fontSize: Platform.OS === 'ios' && Platform.isPad ? 23 : 14,
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
    height: Platform.OS === 'ios' && Platform.isPad ? 50 : 45 ,
    marginTop: 10,
    width: Platform.OS === 'ios' && Platform.isPad ? 450 : 350,
    alignItems: "center"
  },
  container: {
    marginTop: 50,
    marginBottom:-50,
  },
  button: {
    fontSize: Platform.OS === 'ios' && Platform.isPad ? 40 : 24 ,
  },
  bottomTextContainer: {
    flex: 1, 
    justifyContent: 'flex-end',
    alignItems: 'center', 
    marginBottom: 50
  },
  bottomText: {
    fontSize: Platform.OS === 'ios' && Platform.isPad ? 26 : 16 ,
  },
});
