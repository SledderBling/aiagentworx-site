// Cloudflare Pages Function: POST /api/contact
// Receives the contact form submission, stores it in KV (if bound),
// emails via Resend (if RESEND_API_KEY is set), then 303-redirects to /thanks.

interface Env {
  CONTACT_FORM_KV?: KVNamespace;
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
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
  try {
    if (env.CONTACT_FORM_KV) {
      const key = `contact:${Date.now()}:${crypto.randomUUID()}`;
      await env.CONTACT_FORM_KV.put(key, JSON.stringify(submission));
    }
  } catch (err) {
    console.error("KV write failed:", err);
  }

  // 2) Send notification email via Resend
  try {
    if (env.RESEND_API_KEY) {
      const to = env.CONTACT_TO_EMAIL ?? "brian@aiagentworx.ai";
      const from = env.CONTACT_FROM_EMAIL ?? "AI Agent Worx <noreply@aiagentworx.ai>";
      const subject = `New contact form: ${submission.name || "(no name)"}`;

      const visibleFields = Object.entries(submission)
        .filter(([k]) => !k.startsWith("_") && k !== "website")
        .map(([k, v]) => `${k.padEnd(15)}: ${v}`)
        .join("\n");

      const body = `New submission from aiagentworx.ai

${visibleFields}

---
Submitted: ${submission._submitted_at}
IP:        ${submission._ip}
Referer:   ${submission._referer}
`;

      const replyTo =
        typeof submission.email === "string" && submission.email
          ? submission.email
          : undefined;

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text: body,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        console.error("Resend send failed:", resp.status, errBody);
      }
    }
  } catch (err) {
    console.error("Resend send error:", err);
  }

  // 3) Redirect to thank-you page
  return Response.redirect(`${url.origin}/thanks`, 303);
};
