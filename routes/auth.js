const express = require('express');
const router = express.Router();
const { db } = require('../db/schemas');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');

// Register
router.post('/register', async (req, res) => {
  try {
    const schema = Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      role: Joi.string().valid('admin','manager','viewer').optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.json({ success: false, message: error.details[0].message });

    const existing = await db('users').where('email', value.email).first();
    if (existing) return res.json({ success: false, message: 'Email already registered' });

    const hashed = await bcrypt.hash(value.password, 11);
    const [id] = await db('users').insert({
      name: value.name, email: value.email,
      password: hashed, role: value.role || 'manager',
    });
    res.json({ success: true, message: 'Registration successful', id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ success: false, message: 'Email and password required' });

    const user = await db('users').where('email', email).first();
    if (!user) return res.json({ success: false, message: 'Invalid credentials' });
    if (!user.is_active) return res.json({ success: false, message: 'Account is inactive' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign(
      { id_users: user.id_users, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ success: true, token, user: { id: user.id_users, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const user = await db('users').where('id_users', req.user.id_users).select('id_users','name','email','role').first();
  res.json({ success: true, user });
});

module.exports = router;