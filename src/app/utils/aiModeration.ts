import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

/**
 * Checks if content (post/job) is relevant to the community's niche.
 * Returns { allowed: true } if relevant, { allowed: false, reason: string } if not.
 */
export const checkContentRelevance = async (
  content: { title?: string; description?: string; caption?: string },
  communityTags: string[],
  communityName: string
): Promise<{ allowed: boolean; reason?: string }> => {
  // If no tags defined, allow everything
  if (!communityTags || communityTags.length === 0) {
    return { allowed: true };
  }

  const contentText = [
    content.title || content.caption || "",
    content.description || "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!contentText) return { allowed: true };

  const tagsText = communityTags.join(", ");

  const prompt = `You are a STRICT content moderator for the "${communityName}" community.
Community niche tags: ${tagsText}

Content to evaluate:
"${contentText.substring(0, 500)}"

RULES:
1. Only ALLOW content that is DIRECTLY about: ${tagsText}
2. BLOCK anything unrelated (e.g. software development in an FMCG community)
3. Be strict - when in doubt, BLOCK it

Reply with ONLY a JSON object, no markdown, no explanation:
{"allowed": true}
OR
{"allowed": false, "reason": "one sentence reason"}

JSON only, nothing else:`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText =
      message.content[0]?.type === "text" ? (message.content[0] as { type: "text"; text: string }).text.trim() : "";

    // Strip markdown code blocks if present (Claude sometimes wraps JSON in ```json...```)
    const cleanText = responseText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanText);
    return {
      allowed: parsed.allowed === true,
      reason: parsed.reason,
    };
  } catch (err) {
    // On any error (API or parse), allow the content through
    console.error("[AI Moderation] Error:", err);
    return { allowed: true };
  }
};
