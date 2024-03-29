const express = require('express');
const app = express();

const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
// const fileUpload = require('express-fileupload')
const dotenv = require('dotenv');
const path = require('path')

const errorMiddleware = require('./middlewares/errors')

// Setting up config file 
// if (process.env.NODE_ENV !== 'PRODUCTION') require('dotenv').config({ path: 'backend/config/config.env' })
dotenv.config({ path: 'backend/config/config.env' })

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser())
// app.use(fileUpload());


// Import all routes
const images = require('./routes/image');
const products = require('./routes/product');
const auth = require('./routes/auth');
const order = require('./routes/order');
const delivery = require('./routes/delivery');
const info = require('./routes/info')
const offer = require('./routes/offer');



app.use('/assets', images)
app.use('/api/v1', products)
app.use('/api/v1', auth)
app.use('/api/v1', order)
app.use('/api/v1', info)
app.use('/api/v1', delivery)
app.use('/api/v1', offer)



// Middleware to handle errors
app.use(errorMiddleware);

module.exports = app