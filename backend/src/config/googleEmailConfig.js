// Settings for the mail sender used by MFA.

export const googleEmailConfig = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS, typical Gmail setup
  user: 'youchat.dev@gmail.com',
  // App password from Google, written without spaces
  pass: 'dnbslycppnoctovq',
  from: 'YouChat Security <youchat.dev@gmail.com>',
};


