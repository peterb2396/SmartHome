
import React from 'react';
import { Routes, Route } from "react-router-dom";

import Nav from './Nav';
import Account from './Account';
import ContactForm from './ContactForm';
import Dashboard from './Dashboard';


const MyRouter = ({host}) => {
   
    return (
      <div style = {{display: "flex", flexDirection: "column", width: "100vw", height: "100vh"}}>
    {/* Navbar section */}
    
    <Nav></Nav>
      <Routes>
          <Route index element={<Dashboard/>} />
          <Route path="account" element={<Account host = {host}/>} />
          <Route path="contact" element={<ContactForm host = {host}/>} />
      </Routes>
    
      
    
    </div>
  

    )

}

export default MyRouter;