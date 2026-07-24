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

  const prompt = `You are a community content moderator for "${communityName}", a business community focused on: ${tagsText}.

A user wants to post this content:
"${contentText.substring(0, 500)}"

Is this content relevant to this community's niche (${tagsText})?

Reply with ONLY a JSON object in this exact format:
{"allowed": true} 
OR
{"allowed": false, "reason": "Brief explanation of why this content doesn't match the community niche"}

No other text.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText =
      message.content[0]?.type === "text" ? (message.content[0] as { type: "text"; text: string }).text.trim() : "";

    // Parse JSON response
    const parsed = JSON.parse(responseText);
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
