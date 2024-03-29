const User = require("../models/user");

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middlewares/catchAsyncErrors");
const sendToken = require("../utils/jwtToken");
const sendEmail = require("../utils/sendMessage");
const { compare } = require("bcryptjs");

// const crypto = require("crypto");
// const cloudinary = require("cloudinary");



//registerOTP => /api/v1/register/otp

exports.registerOtp = catchAsyncErrors(async (req, res, next) => {
  // Get reset token
  const user = await User.findOne({ phone: req.body.phone });

  if (!user) {
    return next(new ErrorHandler("User not found with this phone", 404));
  }

  const resetToken = user.getRegisterToken();

  await user.save({ validateBeforeSave: false });

  // const message = `Your password reset token is as follow:\n\n${resetToken}\n\nIf you have not requested this phone, then ignore it.`;
  const message = `Your password reset token is as follow:\n ${resetToken}\n\nIf you have not requested this phone, then ignore it.`;

  try {
    await sendEmail({
      phone: user.phone,
      subject: "KSS Password Recovery",
      message,
    });

    res.status(200).json({
      success: true,
      message: `Email sent to: ${user.phone}`,
    });
  } catch (error) {
    user.registerToken = undefined;
    user.registerExpire = undefined;

    await user.save({ validateBeforeSave: false });

    return next(new ErrorHandler(error.message, 500));
  }
})

// Register a user   => /api/v1/register

exports.registerUser = catchAsyncErrors(async (req, res, next) => {
  var user = await User.findOne({ phone: req.body.phone });

  const { name, email, phone, password, phone2, confPassword } = req.body;
  if (req.body.password !== req.body.confPassword) {
    return next(new ErrorHandler("Passwords not match", 401));
  }
  

  if (user) {
    return next(new ErrorHandler("User with this phone number already exist", 404));
  }
   try {
    const user = await User.create({
      name,
      email,
      phone,
      phone2,
      password,
      confPassword,
    });
  

  res.status(200).json({
    success: true,
    user,
  });
   } catch (err) {
    next(err);
   }

});

// validateOtp  => /api/v1/register/validation
exports.validateUserSignUp = catchAsyncErrors(async (req, res, next) => {
  const { registerUserToken } = req.body;

  const user = await User.findOne({ phone: req.body.phone });

  if (!user) {
    return next(
      new ErrorHandler(
        "Password reset token is invalid or has been expired",
        400
      )
    );
  }
  if (req.body.registerUserToken
    !== user.registerUserToken
  ) {
    return next(new ErrorHandler("invalid otp", 400));
  }
  sendToken(user, 200, res);
});



// Login User  =>  /api/v1/login


exports.loginUser = catchAsyncErrors(async (req, res, next) => {
  const { phone, password } = req.body;

  // Checks if email and password is entered by user
  if (!phone || !password) {
    return next(new ErrorHandler("Please enter phone & password", 400));
  }

  // Finding user in database
  const user = await User.findOne({ phone }).select("+password");

  if (!user) {
    return next(new ErrorHandler("Invalid phone or Password", 401));
  }

  // Checks if password is correct or not
  const isPasswordMatched = await user.comparePassword(password);

  if (!isPasswordMatched) {
    return next(new ErrorHandler("Invalid phone or Password", 401));
  }

  sendToken(user, 200, res);
});

// Forgot Password   =>  /api/v1/password/forgot
exports.forgotPassword = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findOne({ phone: req.body.phone });

  if (!user) {
    return next(new ErrorHandler("User not found with this phone", 404));
  }

  // Get reset token
  const resetToken = user.getResetPasswordToken();

  await user.save({ validateBeforeSave: false });

  // const message = `Your password reset token is as follow:\n\n${resetToken}\n\nIf you have not requested this phone, then ignore it.`;
  const message = `Your password reset token is as follow:\n ${resetToken}\n\nIf you have not requested this phone, then ignore it.`;

  try {
    await sendEmail({
      phone: user.phone,
      subject: "KSS Password Recovery",
      message,
    });

    res.status(200).json({
      success: true,
      message: `OTP sent to: ${user.phone}`,
    });
  } catch (error) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save({ validateBeforeSave: false });

    return next(new ErrorHandler(error.message, 500));
  }
});

// Reset Password   =>  /api/v1/password/otp
exports.otp = catchAsyncErrors(async (req, res, next) => {
  // Hash URL token
  const { resetPasswordToken } = req.body;

  const user = await User.findOne({ phone: req.body.phone });

  if (!user) {
    return next(
      new ErrorHandler(
        "Password reset token is invalid or has been expired",
        400
      )
    );
  }


  if (req.body.resetPasswordToken !== user.resetPasswordToken) {
    return next(new ErrorHandler("invalid otp", 400));
  }

  res.status(200).json({
    success: true,
  });
});





// Reset Password   =>  /api/v1/password/reset/:token
exports.resetPassword = catchAsyncErrors(async (req, res, next) => {
  // Hash URL token
  const { resetPasswordToken } = req.body;

  const user = await User.findOne({
    phone: req.body.phone
  });

  if (!user) {
    return next(
      new ErrorHandler(
        "Password reset token is invalid or has been expired",
        400
      )
    );
  }

  if (req.body.password !== req.body.confirmPassword) {
    return next(new ErrorHandler("Password does not match", 400));
  }
  if (req.body.resetPasswordToken !== user.resetPasswordToken) {
    return next(new ErrorHandler("invalid otp", 400));
  }

  // Setup new password
  user.password = req.body.password;

  await user.save();

  sendToken(user, 200, res);
});

// Get currently logged in user details   =>   /api/v1/me
exports.getUserProfile = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  res.status(200).json({
    success: true,
    user,
  });
});

// Update / Change password   =>  /api/v1/password/update
exports.updatePassword = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+password");

  // Check previous user password
  const isMatched = await user.comparePassword(req.body.oldPassword);
  if (!isMatched) {
    return next(new ErrorHandler("Old password is incorrect"));
  }

  user.password = req.body.password;
  await user.save();

  sendToken(user, 200, res);
});

// Update user profile   =>   /api/v1/me/update
exports.updateProfile = catchAsyncErrors(async (req, res, next) => {
  const newUserData = {
    name: req.body.name,
    email: req.body.email,
  };

  const user = await User.findByIdAndUpdate(req.user.id, newUserData, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });

  res.status(200).json({
    success: true,
  });
});

// Logout user   =>   /api/v1/logout
exports.logout = catchAsyncErrors(async (req, res, next) => {
  res.cookie("token", null, {
    expires: new Date(Date.now()),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    message: "Logged out",
  });
});

// Admin Routes

// Get all users   =>   /api/v1/admin/users
exports.allUsers = catchAsyncErrors(async (req, res, next) => {
  const users = await User.find();

  res.status(200).json({
    success: true,
    users,
  });
});

// Get user details   =>   /api/v1/admin/user/:id
exports.getUserDetails = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(
      new ErrorHandler(`User does not found with id: ${req.params.id}`)
    );
  }

  res.status(200).json({
    success: true,
    user,
  });
});

// Update user profile   =>   /api/v1/admin/user/:id
exports.updateUser = catchAsyncErrors(async (req, res, next) => {
  const newUserData = {
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    phone2: req.body.phone2,
    role: req.body.role,
  };

  const user = await User.findByIdAndUpdate(req.params.id, newUserData, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });

  res.status(200).json({
    success: true,
  });
});

// Delete user   =>   /api/v1/admin/user/:id
exports.deleteUser = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(
      new ErrorHandler(`User does not found with id: ${req.params.id}`)
    );
  }

  await user.remove();


  res.status(200).json({
    success: true,
  });
});

compareExpDate = function (expDate) {
  let now = new Date().getTime();
  let exp = new Date(expDate).getTime();

  return exp > now;
}