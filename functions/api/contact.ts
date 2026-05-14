// Cloudflare Pages Function: POST /api/contact
// 1) Stores submission in KV (CONTACT_FORM_KV) so nothing is ever lost.
// 2) Pings Brian via Telegram bot for instant notification.
// 3) 303-redirects to /thanks.

interface Env {
  CONTACT_FORM_KV?: KVNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return new Response("Invalid form submission", { status: 400 });
  }

  const submission: Record<string, string> = {
    _submitted_at: new Date().toISOString(),
    _ip: request.headers.get("cf-connecting-ip") ?? "",
    _user_agent: request.headers.get("user-agent") ?? "",
    _referer: request.headers.get("referer") ?? "",
  };
  for (const [key, value] of formData.entries()) {
    submission[key] = typeof value === "string" ? value : "[file]";
  }

  // Honeypot: real users won't fill `website` (it's hidden via CSS).
  if (submission.website && submission.website.length > 0) {
    return Response.redirect(`${url.origin}/thanks`, 303);
  }

  // 1) Persist to KV — never lose a submission
  let kvKey: string | undefined;
  try {
    if (env.CONTACT_FORM_KV) {
      kvKey = `contact:${Date.now()}:${crypto.randomUUID()}`;
      await env.CONTACT_FORM_KV.put(kvKey, JSON.stringify(submission));
    }
  } catch (err) {
    console.error("KV write failed:", err);
  }

  // 2) Telegram notification
  try {
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const esc = (s: string) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

      const name = submission.name || "(no name)";
      const email = submission.email || "(no email)";
      const phone = submission.phone || "(none)";
      const smsConsent =
        submission.sms_consent === "yes" ? "✅ yes" : "❌ no";
      const message = submission.message || "(empty)";

      const text =
        `📨 <b>New contact form submission</b>\n\n` +
        `<b>Name:</b> ${esc(name)}\n` +
        `<b>Email:</b> ${esc(email)}\n` +
        `<b>Phone:</b> ${esc(phone)}\n` +
        `<b>SMS consent:</b> ${smsConsent}\n\n` +
        `<b>Message:</b>\n${esc(message)}\n\n` +
        `<i>Submitted ${esc(submission._submitted_at)}</i>\n` +
        `<i>IP ${esc(submission._ip)}</i>` +
        (kvKey ? `\n<i>KV ${esc(kvKey)}</i>` : "");

      const resp = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        }
      );

      if (!resp.ok) {
        const errBody = await resp.text();
        console.error("Telegram send failed:", resp.status, errBody);
      }
    } else {
      console.warn(
        "Telegram env not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)"
      );
    }
  } catch (err) {
    console.error("Telegram send error:", err);
  }

  // 3) Redirect to thank-you page
  return Response.redirect(`${url.origin}/thanks`, 303);
};
