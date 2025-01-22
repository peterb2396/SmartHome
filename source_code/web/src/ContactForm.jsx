import React, { useState } from 'react';
import axios from 'axios';

const ContactForm = (props) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const [fail, setFail] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = {
      name: name,
      email: email,
      message: message,
    };
    axios.post(`${props.host}/contact`, formData)
      .then(function (response) {
        // Success
      })
      .catch(function (response) {
        console.log(response);
        setFail(true);
      });

    setDone(true);
  };

  if (done) {
    if (fail) {
      return (
        <div style={{
          margin: "10%",

          display: 'flex',
          alignItems: 'center',
          flexDirection: 'column',
        }}>
          <h1 style={{ color: 'rgb(92, 119, 226)' }}>Oh no!</h1>
          <p style={{ color: 'gray' }}>There was an error sending your message. Please try again later.</p>
        </div>
      );
    } else {
      // Success
      return (
        <div style={{
          margin: "10%",
          display: 'flex',
          alignItems: 'center',
          flexDirection: 'column',
        }}>
          <h1 style={{ color: 'rgb(92, 119, 226)' }}>Success!</h1>
          <p style={{ color: 'gray' }}>Your message has been sent.</p>
        </div>
      );
    }
  }

  // Message not yet sent: Show form
  return (
    <div style={{
      margin: '20px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <img src='email.png' alt="email icon" width="100px" />
      <p style={{ fontSize: '30px', fontWeight: '100' }}>LET'S GET IN TOUCH.</p>
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '300px' }}>
        <input
          style={{ margin: '5px' }}
          type="text"
          className='form-control'
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          required
        />
        <input
          style={{ margin: '5px' }}
          type="email"
          className='form-control'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (optional)"
        />
        <textarea
          style={{ margin: '5px', height: '200px' }}
          className='form-control'
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Your message"
          required
        />
        <button type="submit" className="btn btn-light" style={{ width: '100%' }}>Send Message</button>
      </form>
    </div>
  );
};

export default ContactForm;
