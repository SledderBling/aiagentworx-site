import staticFormsPlugin from "@cloudflare/pages-plugin-static-forms";

interface Env {
  CONTACT_FORM_KV?: KVNamespace;
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
}

export const onRequest: PagesFunction<Env> = staticFormsPlugin({
  respondWith: async ({ formData, name, request }) => {
    const url = new URL(request.url);
    const env = (request as unknown as { cf: any; env?: Env }).env ?? ({} as Env);

    // Serialize submission
    const submission: Record<string, string> = {
      _form: name,
      _submitted_at: new Date().toISOString(),
      _ip: request.headers.get("cf-connecting-ip") ?? "",
      _user_agent: request.headers.get("user-agent") ?? "",
    };
    for (const [key, value] of formData.entries()) {
      submission[key] = typeof value === "string" ? value : "[file]";
    }

    // 1. Save to KV (if bound) — never lose a submission
    try {
      if (env.CONTACT_FORM_KV) {
        const key = `submission:${name}:${Date.now()}:${crypto.randomUUID()}`;
        await env.CONTACT_FORM_KV.put(key, JSON.stringify(submission), {
          metadata: { form: name, submitted_at: submission._submitted_at },
        });
      }
    } catch (err) {
      console.error("KV write failed:", err);
    }

    // 2. Send email via Resend (if API key set)
    try {
      if (env.RESEND_API_KEY) {
        const to = env.CONTACT_TO_EMAIL ?? "brian@aiagentworx.ai";
        const from = env.CONTACT_FROM_EMAIL ?? "AI Agent Worx <noreply@aiagentworx.ai>";

        const subject =
          name === "contact"
            ? `New contact form: ${submission.name || "(no name)"}`
            : `New ${name} form submission`;

        const lines = Object.entries(submission)
          .filter(([k]) => !k.startsWith("_"))
          .map(([k, v]) => `${k.padEnd(15)}: ${v}`)
          .join("\n");

        const meta = [
          `Submitted: ${submission._submitted_at}`,
          `IP: ${submission._ip}`,
        ].join("\n");

        const body = `New submission from aiagentworx.ai\n\n${lines}\n\n---\n${meta}\n`;

        const replyTo =
          typeof submission.email === "string" && submission.email
            ? submission.email
            : undefined;

        const resendResp = await fetch("https://api.resend.com/emails", {
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

        if (!resendResp.ok) {
          const errBody = await resendResp.text();
          console.error("Resend send failed:", resendResp.status, errBody);
        }
      }
    } catch (err) {
      console.error("Resend send error:", err);
    }

    // 3. Redirect user to thanks page
    return Response.redirect(`${url.origin}/thanks`, 303);
  },
});
