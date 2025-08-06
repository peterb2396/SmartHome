import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios'
import Login from './Login';
import { BrowserRouter, useLocation } from "react-router-dom";
import MyRouter from './MyRouter.jsx';



const Main = () => {

  // const SERVER_URL = `http://localhost:3001`
  // const SERVER_URL = `https://smarthome153.onrender.com`
  const SERVER_URL = `https://server.153home.online`
  
  document.body.style = 'background: #f2f2f2';

  const [user, setUser] = useState(null);
  //const [clients, setClients] = useState(null);
  const [loading, setLoading] = useState(true);
  

  

  const login = useCallback((token, storeToken, newAccount, newUser) => {
    if (storeToken) {
      localStorage.setItem('token', token);
    }
  
    axios.post(`${SERVER_URL}/user`, { user_id: token })
      .then(response => {
        setUser({
          id: response.data.user._id,
          email: response.data.user.email,
          name: response.data.user.name,
          company: response.data.user.company,
        });
  
        //setClients(response.data.user.clients);
        setLoading(false);
      })
      .catch(error => {
        console.log(error);
        setLoading(false);
      });
  }, [SERVER_URL, setUser, setLoading]);
  

  useEffect(() => {
    // Check local storage for user token
    const token = localStorage.getItem('token');
    if (token) {
      login(token, false, false, null)
    }
    else {
      // Redirect to login
      setLoading(false)

    }
    
  }, [login]);


  // Scroll to top on route change
  const ScrollToTopOnRouteChange = () => {
    const { pathname } = useLocation();
  
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);
  
    return null; // This component doesn't render anything
  };



  if (loading) {
    return (
      <p>Loading...</p>
    )
  }

  if (!user) {
    return (
      <Login login = {login} api = {SERVER_URL}/>
    )
  }

  // Render the main page, user is logged in
  return (

    <BrowserRouter>
      <ScrollToTopOnRouteChange />
      <MyRouter host={SERVER_URL} />
    </BrowserRouter>
  );
};


export default Main;
