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
app.use('/api/auth', authRouter);
app.use('/api/apartment', apartmentRouter);
app.use('/api/buildings', buildingsRouter);
app.use('/api/shareholders', shareholdersRouter);
app.use('/api/units', unitsRouter);
app.use('/api/costing', costingRouter);
app.use('/api/payments', paymentsRouter);

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
});

module.exports = app;
