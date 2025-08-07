
import React from 'react';
import { Routes, Route } from "react-router-dom";

import Nav from './Nav';
// import Account from './Account';
import Dashboard from './Dashboard';
import Lights from './Lights';


const MyRouter = ({host}) => {
   
    return (
      <div style = {{display: "flex", flexDirection: "column", width: "100vw",
        background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        height: "100vh",
  overflowY: "auto", }}>
    {/* Navbar section */}
    
    <Nav></Nav>
      <Routes>
          <Route index element={<Lights BASE_URL = {host}/>} />
          <Route path="settings" element={<Dashboard BASE_URL = {host}/>} />
          {/* <Route path="account" element={<Account host = {host}/>} /> */}

      </Routes>
    
      
    
    </div>
  

    )

}

export default MyRouter;