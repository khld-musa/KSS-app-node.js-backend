const app = require('./app');
const connectDatabase = require('./config/database');

process.on('uncaughtException', (err) => {
  console.error(`ERROR: ${err.stack}`);
  console.error('Shutting down due to uncaught exception');
  process.exit(1);
});

connectDatabase().catch((err) => {
  console.error(`MongoDB connection failed: ${err.message}`);
  process.exit(1);
});

const server = app.listen(process.env.PORT, () => {
  console.log(`Server started on PORT: ${process.env.PORT} in ${process.env.NODE_ENV} mode.`);
});

process.on('unhandledRejection', (err) => {
  console.error(`ERROR: ${err.stack}`);
  console.error('Shutting down the server due to unhandled promise rejection');
  server.close(() => process.exit(1));
});
