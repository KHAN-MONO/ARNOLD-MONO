'use strict';
async function sendEmail(opts) { console.log('Email:', opts.to); }
async function sendWelcomeEmail(user) { console.log('Welcome:', user.email); }
async function sendPasswordResetEmail(user, token) { console.log('Reset:', user.email); }
async function sendPaymentConfirmEmail(user, payment) { console.log('Payment:', user.email); }
module.exports = { sendEmail, sendWelcomeEmail, sendPasswordResetEmail, sendPaymentConfirmEmail };
