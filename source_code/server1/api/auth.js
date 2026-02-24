/**
 * Auth Routes
 * ─────────────────────────────────────────────────────────────────
 * POST /log-or-reg          Login or register (combined)
 * POST /login               Login only
 * POST /register            Register only
 * POST /user                Get user by ID
 * POST /confirmDevice       Verify 2FA code
 * POST /resetPassword       Send reset code to email
 * POST /setNewPassword      Set a new password using reset code
 * POST /update-account      Change password or company name
 * POST /deleteAccount       Delete account
 * POST /contact             Send support email
 */

const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const User    = require('../db/userModel');
const settingsSvc = require('../services/settings');
const { sendMail } = require('../services/mail');

const SALT_ROUNDS     = 5;
const BYPASS_2FA      = false;
const APP_NAME        = () => process.env.APP_NAME;

// ── Helpers ─────────────────────────────────────────────────────────────────────

async function sendCode(user, device) {
  const code = Math.floor(Math.random() * 90000) + 10000;
  await User.findByIdAndUpdate(user._id, {
    code,
    pending_device: device,
    code_attempts:  0,
  }, { new: true });

  const ok = await sendMail(
    process.env.MAILER_USER,
    user.email,
    `${code} is your ${APP_NAME()} confirmation code`,
    `A new device was used to log in. If this was you, enter ${code} in the app.`,
    process.env.MAILER_PASS
  );

  if (!ok) throw new Error('Could not send confirmation email.');
  return true;
}

function verifyUser(uid, password) {
  return User.findById(uid).then(user => {
    if (!user) return Promise.reject({ status: 404, message: 'User not found' });
    return bcrypt.compare(password, user.password).then(match => {
      if (!match) return Promise.reject({ status: 401, message: 'Wrong password' });
      return user;
    });
  });
}

const excludePassword = obj => { const o = { ...obj }; delete o.password; return o; };

// ── Login or Register ────────────────────────────────────────────────────────────

router.post('/log-or-reg', async (req, res) => {
  await settingsSvc.refresh();
  const settings = settingsSvc.get();

  const user = await User.findOne({ email: req.body.email }).catch(() => null);

  if (user) {
    // ── Login ──
    const match = await bcrypt.compare(req.body.password, user.password).catch(() => false);
    if (!match) return res.status(400).json({ message: 'Passwords do not match' });

    try {
      await sendCode(user, req.body.device);
      return res.status(422).json({ message: true });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }

  // ── Register ──
  const whitelist = (settings.users_whitelist || '').split(',').map(s => s.trim());
  if (!whitelist.includes(req.body.email)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const hashedPassword = await bcrypt.hash(req.body.password, SALT_ROUNDS);
  const newUser = new User({ email: req.body.email, password: hashedPassword, email_confirmed: BYPASS_2FA });

  await newUser.save().catch(err => {
    throw Object.assign(err, { status: 500 });
  });

  if (BYPASS_2FA) {
    return res.status(200).json({ message: 'Registration Successful', token: newUser._id, new_account: true });
  }

  try {
    await sendCode(newUser, req.body.device);
    return res.status(422).json({ message: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── Login (standalone) ───────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).catch(() => null);
  if (!user) return res.status(404).json({ message: 'Email not found' });

  const match = await bcrypt.compare(req.body.password, user.password).catch(() => false);
  if (!match) return res.status(400).json({ message: 'Passwords do not match' });

  if (user.devices?.includes(req.body.device) || user.email === 'demo@demo.demo') {
    return res.status(200).json({
      message:     'Login Successful',
      token:       user._id,
      new_account: !user.account_complete,
      new_user:    false,
    });
  }

  try {
    await sendCode(user, req.body.device);
    res.status(422).json({ message: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Confirm device (2FA) ─────────────────────────────────────────────────────────

router.post('/confirmDevice', async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) return res.status(404).json({ message: 'Could not find user' });

  if (user.code == req.body.code) {
    return res.status(200).json({ message: 'Success!', token: user._id });
  }

  if (user.code_attempts >= 2) {
    return res.status(429).json({ message: 'Too many attempts!' });
  }

  await User.findByIdAndUpdate(user._id, { $inc: { code_attempts: 1 } });
  res.status(401).json({ message: 'Wrong code!' });
});

// ── Get user ─────────────────────────────────────────────────────────────────────

router.post('/user', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.body.user_id, { $set: { dormant: 0 } }, { new: true })
    .catch(() => null);

  if (!user) return res.status(404).json({ message: 'User not found!' });
  res.status(200).json({ user: excludePassword(user.toObject()) });
});

// ── Password reset ────────────────────────────────────────────────────────────────

router.post('/resetPassword', async (req, res) => {
  const code = Math.floor(Math.random() * 90000) + 10000;
  await User.findOneAndUpdate({ email: req.body.email }, { $set: { code } });
  const ok = await sendMail(
    process.env.MAILER_USER,
    req.body.email,
    `${code} is your ${APP_NAME()} confirmation code`,
    `A password reset was requested. If this was you, enter ${code} in the app.`,
    process.env.MAILER_PASS
  );
  ok
    ? res.status(200).json({ message: 'Sent code!' })
    : res.status(500).json({ message: 'Could not send mail!' });
});

router.post('/setNewPassword', async (req, res) => {
  const { resetCode, pass, email } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.code != resetCode) return res.status(401).json('Unauthorized');

  const hashed = await bcrypt.hash(pass, SALT_ROUNDS);
  user.password = hashed;
  await user.save();
  res.status(200).json({ message: 'Password changed successfully', token: user._id });
});

// ── Update account ────────────────────────────────────────────────────────────────

router.post('/update-account', async (req, res) => {
  const { uid, password, newpass, newcompanyname } = req.body;
  try {
    const user = await verifyUser(uid, password);
    if (!newpass && newcompanyname === user.company) {
      return res.status(400).json({ message: 'No changes provided' });
    }
    const fields = {};
    if (newcompanyname) fields.company = newcompanyname;
    if (newpass) fields.password = await bcrypt.hash(newpass, 10);
    const updated = await User.findByIdAndUpdate(uid, fields, { new: true });
    res.json({ id: updated._id });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
  }
});

// ── Register (standalone) ─────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const hashed = await bcrypt.hash(req.body.password, SALT_ROUNDS);
    const user   = new User({ email: req.body.email, password: hashed });
    const result = await user.save();
    res.status(201).json({ message: 'User Created Successfully', result });
  } catch (err) {
    let msg = 'User already exists!';
    for (const key in err.errors) {
      if (err.errors[key].properties?.message) { msg = err.errors[key].properties.message; break; }
    }
    res.status(err.code === 11000 ? 403 : 500).json({ message: msg });
  }
});

// ── Delete account ────────────────────────────────────────────────────────────────

router.post('/deleteAccount', async (req, res) => {
  const user = await User.findById(req.body.id).catch(() => null);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const match = await bcrypt.compare(req.body.password, user.password).catch(() => false);
  if (!match) return res.status(400).json({ message: 'Passwords do not match' });

  await User.findByIdAndDelete(req.body.id);
  res.status(200).json({ message: 'Delete Successful' });
});

// ── Support contact ───────────────────────────────────────────────────────────────

router.post('/contact', async (req, res) => {
  const ok = await sendMail(
    process.env.MAILER_USER,
    process.env.MAILER_USER,
    `${APP_NAME()} Support`,
    `${req.body.msg}\n\nfrom ${req.body.email} (${req.body.uid})`,
    process.env.MAILER_PASS
  );
  ok ? res.status(200).send('Success') : res.status(500).send('Error');
});

module.exports = router;
