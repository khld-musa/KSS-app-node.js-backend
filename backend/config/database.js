const mongoose = require('mongoose');

const connectDatabase = async () => {
  const con = await mongoose.connect(process.env.DB_LOCAL_URI);
  console.log(`MongoDB connected: ${con.connection.host}/${con.connection.name}`);
  return con;
};

module.exports = connectDatabase;
