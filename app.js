require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const authRouter = require('./routes/auth');
const buildingsRouter = require('./routes/buildings');
const shareholdersRouter = require('./routes/shareholders');
const unitsRouter = require('./routes/units');
const costingRouter = require('./routes/costing');
const paymentsRouter = require('./routes/payments');
const apartmentRouter = require('./routes/apartment');
const bdLocalRouter = require('./routes/bd-local');
const collectionsRouter = require('./routes/collections');
const payRouter = require('./routes/pay');
const opsRouter = require('./routes/ops');
const scheduler = require('./jobs/scheduler');
const checkAuth = require('./middleware/auth');
const { staffOr } = checkAuth;

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set — refusing to start without it.');
  process.exit(1);
}

const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, true); // Allow all dev origins cleanly
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Accept'],
}));

app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', project: 'Apartment Construction & Owner Management System', time: new Date() }));

// Routes
// Every business route needs a logged-in user. Staff (admin/manager) can use everything;
// flat-owner logins ('viewer') can only reach their own portal and online payment.
const staffOnly = staffOr([]);
app.use('/api/auth', authRouter);
app.use('/api/apartment', checkAuth, staffOr(['/owner-portal']), apartmentRouter);
app.use('/api/bd-local', checkAuth, staffOnly, bdLocalRouter);
app.use('/api/collections', checkAuth, staffOnly, collectionsRouter);
// Building operations: tenants & rent, service charge billing, staff payroll, gate/parking/notices.
// Owners may only read the notice board and use their own complaints desk.
app.use('/api/ops', checkAuth, staffOr(['/gate/portal', '/helpdesk/portal']), opsRouter);
app.use('/api/pay', payRouter); // gateway callbacks are public; the router checks auth per route
app.use('/api/buildings', checkAuth, staffOnly, buildingsRouter);
app.use('/api/shareholders', checkAuth, staffOnly, shareholdersRouter);
app.use('/api/units', checkAuth, staffOnly, unitsRouter);
app.use('/api/costing', checkAuth, staffOnly, costingRouter);
app.use('/api/payments', checkAuth, staffOnly, paymentsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
});

// Use 5050 by default since 5000 is occupied by macOS AirPlay/ControlCenter
const PORT = (process.env.PORT && process.env.PORT !== '5000') ? process.env.PORT : 5050;

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(' Multi-Owner Apartment Construction & Financial Management API');
  console.log(`========================================`);
  console.log(` Server running at: http://localhost:${PORT}`);
  console.log(` Health check:      http://localhost:${PORT}/health`);
  console.log(` Apartment API:     http://localhost:${PORT}/api/apartment/dashboard`);
  console.log('========================================\n');
  scheduler.start();
});

module.exports = app;
