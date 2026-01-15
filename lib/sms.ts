type SmsPayload = {
  to: string;
  body: string;
};

export async function sendSms(_payload: SmsPayload) {
  throw new Error("SMS not configured");
}
