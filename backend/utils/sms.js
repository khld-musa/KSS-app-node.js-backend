// Sends SMS through the gateway configured in config.env.
// In tests (SMS_TRANSPORT=memory) messages are captured in `outbox` instead.
// In development with no SMS_API_KEY they are printed to the console.

const outbox = [];

async function sendSms({ to, text }) {
  if (process.env.SMS_TRANSPORT === 'memory' || process.env.NODE_ENV === 'test') {
    outbox.push({ to, text });
    return;
  }

  if (!process.env.SMS_API_KEY) {
    console.log(`[sms] (no SMS_API_KEY set) to=${to}: ${text}`);
    return;
  }

  // URLSearchParams encodes every value, so a crafted phone number or message
  // cannot inject extra gateway parameters.
  const url = new URL(process.env.SMS_BASE_URL || 'https://mazinhost.com/smsv1/sms/api');
  url.searchParams.set('action', 'send-sms');
  url.searchParams.set('api_key', process.env.SMS_API_KEY);
  url.searchParams.set('to', to.replace(/^\+/, ''));
  url.searchParams.set('from', process.env.SMS_SENDER || 'SudaMarket');
  url.searchParams.set('sms', text);
  url.searchParams.set('unicode', '1');

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`SMS gateway responded ${res.status}`);
  }
}

module.exports = { sendSms, outbox };
