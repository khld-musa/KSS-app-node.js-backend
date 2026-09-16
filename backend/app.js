const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config({ path: 'backend/config/config.env', quiet: true });

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set (see backend/config/config.env.example)');
}

const ApiError = require('./utils/ApiError');
const storage = require('./utils/storage');
const errorHandler = require('./middlewares/errors');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  })
);
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Express 5 leaves req.body undefined when no body parser matched
app.use((req, res, next) => {
  req.body ??= {};
  next();
});

app.get('/health', (req, res) => res.json({ success: true }));

// Uploaded images. File names are random and never reused, so they can be cached for a long time.
// Cross-origin is allowed so a web admin on another domain can display them.
app.use(
  storage.PUBLIC_PREFIX,
  express.static(storage.uploadRoot(), {
    index: false,
    dotfiles: 'deny',
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

const api = express.Router();
api.get('/health', (req, res) => res.json({ success: true }));
api.use(require('./routes/auth'));
api.use(require('./routes/address'));
api.use(require('./routes/user'));
api.use(require('./routes/category'));
api.use(require('./routes/store'));
api.use(require('./routes/product'));
api.use(require('./routes/cart'));
api.use(require('./routes/coupon'));
api.use(require('./routes/order'));
api.use(require('./routes/settings'));
api.use(require('./routes/banner'));
api.use(require('./routes/home'));
api.use(require('./routes/wishlist'));
api.use(require('./routes/review'));
app.use('/api/v1', api);

app.use((req, res, next) => {
  next(new ApiError(404, 'NOT_FOUND', `Cannot ${req.method} ${req.originalUrl}`));
});

app.use(errorHandler);

module.exports = app;
