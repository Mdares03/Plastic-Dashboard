type SmsPayload = {
  to: string;
  body: string;
};

export async function sendSms(payload: SmsPayload) {
  void payload;
  throw new Error("SMS not configured");
}
