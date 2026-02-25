const nodemailer = require('nodemailer');
const axios = require('axios');

const transporters = {}; // Cache transporters per sender address

/**
 * Send an email.
 * @param {string} from     Sender address (also used as Gmail login)
 * @param {string} to       Recipient
 * @param {string} subject
 * @param {string} text
 * @param {string} password Gmail app password for `from`
 */
async function sendMail(from, to, subject, text, password) {
  if (!transporters[from]) {
    transporters[from] = nodemailer.createTransport({
      service: 'Gmail',
      auth: { user: from, pass: password },
    });
  }
  try {
    await transporters[from].sendMail({ from, to, subject, text });
    return true;
  } catch (err) {
    console.error(`[Mail] Error sending from ${from}:`, err.message);
    return false;
  }
}

/**
 * Push a notification via Bark app.
 * @param {string} msg
 * @param {string} title
 */
async function sendPush(msg, title = "Alert") {
  const key = process.env.BARK_DEVICE_KEY;
  if (!key) return;

  const url =
    `https://api.day.app/${key}/` +
    `${encodeURIComponent(title)}/` +
    `${encodeURIComponent(msg)}`;

  try {
    const res = await axios.get(url, {
      params: { group: "home", sound: "minuet" },
      timeout: 8000,
    });
    console.log("[Push] Bark response:", res.data);
  } catch (err) {
    console.error("[Push] Error:", err.response?.data || err.message);
  }
}

module.exports = { sendMail, sendPush };
